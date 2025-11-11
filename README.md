# RepoTextractor

RepoTextractor is a web application designed to convert public GitHub repositories into a single, well-formatted text file. This output is optimized for ingestion by Large Language Models (LLMs), enabling them to analyze or understand entire codebases with proper context.

The tool provides an interactive interface to selectively include or exclude files based on various criteria, ensuring the final output is both clean and relevant.

## Features

-   **Flexible URL Input**: Fetches code from various public GitHub URLs, including:
    -   Repository main branches (`.../owner/repo`)
    -   Specific branches (`.../tree/branch-name`)
    -   Tags (`.../tree/tag-name`)
    -   Specific commits (`.../commit/hash`)
    -   Pull requests (`.../pull/123`)
-   **Interactive File Tree**: After previewing a repository, you get a full, interactive directory tree. You can expand/collapse directories and select or deselect any file or folder.
-   **Advanced Filtering Options**:
    -   **File Size**: Exclude files larger than a specified size (in KB).
    -   **Glob Patterns**: Include or exclude files using `.gitignore`-style patterns (e.g., `*.py`, `!dist/*`).
    -   **Binary File Detection**: Automatically detects and excludes non-text (binary) files to keep the output clean for LLMs.
-   **Optimized LLM Output**: The generated text file includes:
    -   A summary of the repository and the filters applied.
    -   A directory tree structure of the included files.
    -   The full content of each file, clearly demarcated.

## Technology Stack

-   **Backend**: Python with **Flask**
-   **Frontend**: Vanilla JavaScript and **jQuery** for DOM manipulation and AJAX.
-   **Styling**: Plain CSS (no frameworks).

## Setup and Installation

Follow these steps to run the application on your local machine.

### 1. Prerequisites

-   Python 3.7+
-   `pip` and `venv`

### 2. Clone the Repository

```bash
git clone https://github.com/your-username/repo-textractor.git
cd repo-textractor
```

### 3. Create and Activate a Virtual Environment

**On macOS/Linux:**

```bash
python3 -m venv venv
source venv/bin/activate
```

**On Windows:**

```bash
python -m venv venv
.\venv\Scripts\activate
```

### 4. Install Dependencies

The project requires `Flask` and `requests`. Create a `requirements.txt` file in the root of the project with the following content:

**`requirements.txt`:**
```
Flask>=2.0
requests>=2.25
```

Now, install these dependencies:

```bash
pip install -r requirements.txt
```

### 5. (Recommended) Set GitHub API Token

To avoid being rate-limited by the GitHub API, you should create a [Personal Access Token (PAT)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) with `public_repo` access.

Then, set it as an environment variable:

**On macOS/Linux:**

```bash
export GITHUB_TOKEN="your_personal_access_token_here"```

**On Windows (Command Prompt):**

```bash
set GITHUB_TOKEN="your_personal_access_token_here"
```

**On Windows (PowerShell):**

```powershell
$env:GITHUB_TOKEN="your_personal_access_token_here"
```

The application will automatically use this token if it's available.

### 6. Run the Application

```bash
flask run --port 5001
```

The application will now be running at `http://127.0.0.1:5001`.

## Usage

1.  Open your web browser and navigate to `http://127.0.0.1:5001`.
2.  Enter the URL of any public GitHub repository into the input field.
3.  Click the **Preview** button.
4.  Wait for the file tree to be fetched and displayed.
5.  Use the filter controls to refine your selection:
    -   Set a maximum file size.
    -   Add glob patterns for inclusion/exclusion.
    -   Select/deselect files and directories in the interactive tree.
6.  Click the **Generate** button.
7.  The backend will process the repository based on your filters. This may take a moment for large repositories.
8.  The final, concatenated text output will appear in the text area at the bottom.
9.  Use the **Copy to Clipboard** button to easily copy the entire output.






