import os
import re
import requests
import zipfile
import io
import tempfile
import shutil
import fnmatch
from flask import Flask, request, jsonify, render_template, Response

# --- Configuration ---
# It's highly recommended to use a GitHub Personal Access Token to avoid rate limiting.
# Store this as an environment variable.
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
# Set a long timeout for requests that download and process repos (in seconds)
# For a production environment, an async task queue (e.g., Celery) is a much better solution.
GUNICORN_TIMEOUT = 300


# --- Flask App Initialization ---
app = Flask(__name__)


# --- Helper Functions ---

def is_binary(file_path):
    """
    Heuristic to check if a file is binary.
    It reads a chunk of the file and checks for the presence of null bytes.
    """
    try:
        with open(file_path, 'rb') as f:
            chunk = f.read(1024)  # Read the first 1KB
            return b'\0' in chunk
    except IOError:
        # If the file cannot be opened, treat it as problematic/binary.
        return True

def get_github_api_headers():
    """Returns headers for GitHub API requests, including authentication if a token is provided."""
    headers = {
        'Accept': 'application/vnd.github.v3+json',
    }
    if GITHUB_TOKEN:
        headers['Authorization'] = f'token {GITHUB_TOKEN}'
    return headers

def parse_github_url(url):
    """
    Parses various GitHub URL formats to extract owner, repo, and ref (branch, tag, commit, or PR).
    Returns a dictionary with owner, repo, and ref, or None if parsing fails.
    """
    # Regex to match various GitHub URL formats
    patterns = [
        # https://github.com/owner/repo
        r"https://github\.com/([^/]+)/([^/]+)/?$",
        # https://github.com/owner/repo/tree/branch-name
        r"https://github\.com/([^/]+)/([^/]+)/tree/([^/]+)",
        # https://github.com/owner/repo/commit/commit-hash
        r"https://github\.com/([^/]+)/([^/]+)/commit/([0-9a-fA-F]+)",
        # https://github.com/owner/repo/pull/123
        r"https://github\.com/([^/]+)/([^/]+)/pull/(\d+)"
    ]

    for pattern in patterns:
        match = re.match(pattern, url)
        if match:
            owner, repo = match.groups()[0:2]
            ref_type = "default"
            ref_value = None

            if "tree" in url:
                ref_type = "branch" # Could also be a tag
                ref_value = match.groups()[2]
            elif "commit" in url:
                ref_type = "commit"
                ref_value = match.groups()[2]
            elif "pull" in url:
                ref_type = "pull"
                ref_value = match.groups()[2]

            return {'owner': owner, 'repo': repo, 'ref_type': ref_type, 'ref_value': ref_value}

    return None

def get_ref_from_url_info(url_info):
    """
    Determines the specific Git ref (commit hash or branch/tag name) to download.
    Handles PRs and default branches by making additional API calls.
    """
    owner = url_info['owner']
    repo = url_info['repo']
    ref_type = url_info['ref_type']
    ref_value = url_info['ref_value']

    headers = get_github_api_headers()

    if ref_type == 'pull':
        # For PRs, we need to get the head commit SHA from the PR's branch
        pr_api_url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{ref_value}"
        response = requests.get(pr_api_url, headers=headers)
        response.raise_for_status()
        return response.json()['head']['sha']

    if ref_type == 'default':
        # For default branch, we need to query the repo details
        repo_api_url = f"https://api.github.com/repos/{owner}/{repo}"
        response = requests.get(repo_api_url, headers=headers)
        response.raise_for_status()
        return response.json()['default_branch']

    # For branch, tag, or commit, the ref_value is what we use
    return ref_value

def generate_directory_tree(paths):
    """Generates a string representation of a directory tree from a list of file paths."""
    tree = {}
    for path in sorted(paths):
        parts = path.split('/')
        node = tree
        for part in parts:
            node = node.setdefault(part, {})

    def build_tree_string(node, indent=""):
        s = ""
        children = sorted(node.keys())
        for i, key in enumerate(children):
            is_last = (i == len(children) - 1)
            s += indent
            if is_last:
                s += "└── "
                next_indent = indent + "    "
            else:
                s += "├── "
                next_indent = indent + "│   "
            s += key + "\n"
            if node[key]:
                s += build_tree_string(node[key], next_indent)
        return s

    return build_tree_string(tree)

def estimate_token_count(text):
    """A simple heuristic to estimate token count (1 token ~= 4 chars)."""
    return len(text) // 4


# --- API Endpoints ---

@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/api/get-tree', methods=['GET'])
def get_tree():
    """
    API endpoint to fetch the file tree of a repository.
    Responds quickly by only fetching metadata, not content.
    """
    url = request.args.get('url')
    if not url:
        return jsonify({"error": "URL parameter is required."}), 400

    url_info = parse_github_url(url)
    if not url_info:
        return jsonify({"error": "Invalid or unsupported GitHub URL format."}), 400

    try:
        ref = get_ref_from_url_info(url_info)
        tree_url = f"https://api.github.com/repos/{url_info['owner']}/{url_info['repo']}/git/trees/{ref}?recursive=1"

        response = requests.get(tree_url, headers=get_github_api_headers())
        response.raise_for_status()

        tree_data = response.json()
        if tree_data.get("truncated"):
            # Handle the case where the repo is too large for the recursive tree API
            # For simplicity, we'll return an error. A more robust solution might fetch tree levels individually.
            return jsonify({"error": "Repository is too large to fetch the file tree via this method."}), 413

        files = [{"path": item['path'], "size": item.get('size', 0)} for item in tree_data.get('tree', []) if item['type'] == 'blob']
        return jsonify(files)

    except requests.exceptions.RequestException as e:
        status_code = e.response.status_code if e.response else 500
        if status_code == 404:
            return jsonify({"error": "Repository not found or is private. Please check the URL."}), 404
        return jsonify({"error": f"Failed to fetch repository data from GitHub: {e}"}), status_code
    except Exception as e:
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500


@app.route('/api/generate', methods=['POST'])
def generate():
    """
    API endpoint to download, filter, and process a repository into a single text output.
    This is a long-running task.
    """
    data = request.get_json()
    url = data.get('url')
    filters = data.get('filters', {})

    if not url:
        return jsonify({"error": "URL is required."}), 400

    url_info = parse_github_url(url)
    if not url_info:
        return jsonify({"error": "Invalid GitHub URL."}), 400

    temp_dir = tempfile.mkdtemp()
    try:
        ref = get_ref_from_url_info(url_info)
        zip_url = f"https://api.github.com/repos/{url_info['owner']}/{url_info['repo']}/zipball/{ref}"

        response = requests.get(zip_url, headers=get_github_api_headers(), stream=True)
        response.raise_for_status()

        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            z.extractall(temp_dir)

        # The extracted folder has a generated name, find it
        extracted_root_folder = os.path.join(temp_dir, os.listdir(temp_dir)[0])

        included_files_content = {}
        ignored_files_count = 0

        # Filtering parameters
        max_size_kb = filters.get('maxSizeKb')
        max_size_bytes = int(max_size_kb) * 1024 if max_size_kb else None
        glob_patterns = filters.get('globPatterns', [])
        included_paths = filters.get('includedPaths', [])

        for root, _, files in os.walk(extracted_root_folder):
            for filename in files:
                file_path = os.path.join(root, filename)
                relative_path = os.path.relpath(file_path, extracted_root_folder)

                # --- Apply Filters ---

                # 0. Binary file check (NEW)
                if is_binary(file_path):
                    ignored_files_count += 1
                    continue

                # 1. Included paths filter (from checkbox tree)
                if not any(relative_path.startswith(p) for p in included_paths):
                    ignored_files_count += 1
                    continue

                # 2. File size filter
                if max_size_bytes is not None and os.path.getsize(file_path) > max_size_bytes:
                    ignored_files_count += 1
                    continue

                # 3. Glob pattern filter
                # An empty glob list means no filtering.
                # If globs are present, a file must match at least one positive pattern
                # and must not match any negative (`!`) pattern.
                if glob_patterns:
                    is_excluded_by_glob = any(fnmatch.fnmatch(relative_path, p[1:]) for p in glob_patterns if p.startswith('!'))
                    if is_excluded_by_glob:
                        ignored_files_count += 1
                        continue

                    positive_patterns = [p for p in glob_patterns if not p.startswith('!')]
                    if positive_patterns and not any(fnmatch.fnmatch(relative_path, p) for p in positive_patterns):
                        ignored_files_count += 1
                        continue

                # --- Read File Content ---
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        included_files_content[relative_path] = f.read()
                except Exception:
                    # Fallback for any other reading errors
                    ignored_files_count += 1
                    continue

        # --- Build Final Output ---
        final_output = []
        full_content_for_tokens = ""

        # 1. Summary Header
        summary = (
            f"# Repository Summary\n"
            f"Repository: {url_info['owner']}/{url_info['repo']} (ref: {ref})\n"
            f"Total files included: {len(included_files_content)}\n"
            f"Ignored files: {ignored_files_count}\n"
        )

        # 2. Directory Structure
        dir_tree_str = generate_directory_tree(included_files_content.keys())

        # 3. File Contents
        for path, content in sorted(included_files_content.items()):
            file_block = (
                f"================================================\n"
                f"FILE: {path}\n"
                f"================================================\n"
                f"{content}\n\n"
            )
            final_output.append(file_block)
            full_content_for_tokens += content

        token_count = estimate_token_count(full_content_for_tokens)
        final_summary = summary + f"Approximate token count: {token_count}\n\n"

        final_text = final_summary + "# Directory Structure\n" + dir_tree_str + "\n" + "".join(final_output)

        return Response(final_text, mimetype='text/plain')

    except requests.exceptions.RequestException as e:
        status_code = e.response.status_code if e.response else 500
        return jsonify({"error": f"Failed to download repository: {e}"}), status_code
    except Exception as e:
        return jsonify({"error": f"An error occurred during processing: {e}"}), 500
    finally:
        # Crucial cleanup step to manage server resources
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == '__main__':
    app.run(debug=True, port=15001)
