$(document).ready(function() {
    let fileData = [];

    // --- Event Handlers ---

    $('#preview-btn').on('click', function() {
        const url = $('#repo-url').val().trim();
        if (!url) {
            showError("Please enter a GitHub URL.");
            return;
        }
        fetchFileTree(url);
    });

    $('#generate-btn').on('click', function() {
        generateOutput();
    });

    $('#copy-btn').on('click', function() {
        copyOutputToClipboard();
    });

    // Event delegation for dynamically created checkboxes and toggles
    $('#file-tree').on('change', 'input[type="checkbox"]', handleCheckboxChange);
    $('#file-tree').on('click', '.toggle', handleTreeToggle);


    // --- Core Functions ---

    function fetchFileTree(url) {
        showLoading(true, "Fetching repository file tree...");
        hideConfig();
        hideOutput();
        hideError();

        $.ajax({
            url: `/api/get-tree?url=${encodeURIComponent(url)}`,
            method: 'GET',
            success: function(data) {
                fileData = data;
                renderFileTree(data);
                showConfig();
            },
            error: function(jqXHR) {
                const errorMsg = jqXHR.responseJSON?.error || "An unknown error occurred.";
                showError(errorMsg);
            },
            complete: function() {
                showLoading(false);
            }
        });
    }

    function generateOutput() {
        showProcessing(true);
        hideOutput();
        hideError();

        const payload = {
            url: $('#repo-url').val().trim(),
            filters: {
                maxSizeKb: $('#max-size').val() || null,
                globPatterns: $('#glob-patterns').val().split('\n').filter(p => p.trim() !== ''),
                includedPaths: getIncludedPaths()
            }
        };

        $.ajax({
            url: '/api/generate',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            success: function(responseText) {
                $('#output-text').val(responseText);
                showOutput();
            },
            error: function(jqXHR) {
                const errorMsg = jqXHR.responseJSON?.error || "An unknown error occurred during generation.";
                showError(errorMsg);
            },
            complete: function() {
                showProcessing(false);
            }
        });
    }

    // --- UI Rendering ---

    function renderFileTree(files) {
        const tree = buildTreeObject(files);
        const treeHtml = buildTreeHtml(tree);
        $('#file-tree').html(treeHtml);
    }

    /**
     * [CORRECTED] Builds a clean tree structure from a flat list of file paths.
     * Each node represents a directory and contains a `_files` array and keys for subdirectories.
     */
    function buildTreeObject(files) {
        const root = { _files: [] }; // The root node represents the root directory
        files.forEach(file => {
            const parts = file.path.split('/');
            let currentNode = root;

            parts.forEach((part, index) => {
                if (index === parts.length - 1) {
                    // This is the file part. Add it to the current directory's list of files.
                    currentNode._files.push({ name: part, path: file.path });
                } else {
                    // This is a directory part.
                    if (!currentNode[part]) {
                        // If the directory doesn't exist yet, create it.
                        // Every directory node must also have a `_files` property.
                        currentNode[part] = { _files: [] };
                    }
                    // Move into the subdirectory for the next part of the path.
                    currentNode = currentNode[part];
                }
            });
        });
        return root;
    }

    /**
     * [CORRECTED] Recursively builds the HTML for the file tree from the structured object.
     */
    function buildTreeHtml(node, pathPrefix = '') {
        if (!node) return '';

        let html = '<ul class="tree-level">';

        // 1. Process directories (all keys except '_files'), sorted alphabetically
        const directoryKeys = Object.keys(node).filter(k => k !== '_files').sort();
        directoryKeys.forEach(key => {
            const directoryNode = node[key];
            const currentPath = pathPrefix ? `${pathPrefix}/${key}` : key;

            html += `<li>`;
            html += `<span class="toggle expanded">▼</span>`;
            html += `<input type="checkbox" id="cb-${currentPath}" data-path="${currentPath}" checked>`;
            html += `<label for="cb-${currentPath}">${key}</label>`;

            // Recursive call for the subdirectory's content
            html += buildTreeHtml(directoryNode, currentPath);
            html += `</li>`;
        });

        // 2. Process files (in the _files array), sorted alphabetically
        if (node._files) {
            node._files.sort((a, b) => a.name.localeCompare(b.name)).forEach(file => {
                html += `<li>`;
                html += `<span class="toggle-placeholder"></span>`; // Files don't have a toggle
                html += `<input type="checkbox" id="cb-${file.path}" data-path="${file.path}" checked>`;
                html += `<label for="cb-${file.path}">${file.name}</label>`;
                html += `</li>`;
            });
        }

        html += '</ul>';
        return html;
    }

    // --- UI State Management ---

    function handleCheckboxChange(e) {
        const checkbox = $(e.target);
        const isChecked = checkbox.prop('checked');
        // Apply the same state to all children checkboxes within this `<li>`
        const children = checkbox.closest('li').find('ul input[type="checkbox"]');
        children.prop('checked', isChecked);

        // Update parent checkboxes state
        checkbox.parents('ul.tree-level > li').each(function() {
            const parentLi = $(this);
            const parentCheckbox = parentLi.children('input[type="checkbox"]');
            // Check if any sibling or children of siblings are checked
            const allDescendants = parentLi.parent().find('input[type="checkbox"]');
            const someChecked = allDescendants.is(':checked');
            // Check the parent if any of its descendants are checked
            const parentOfParentCheckbox = parentLi.parent().closest('li').children('input[type="checkbox"]');
            if(parentOfParentCheckbox.length > 0) {
                parentOfParentCheckbox.prop('checked', someChecked);
            }
        });
    }

    function handleTreeToggle(e) {
        const toggle = $(e.target);
        toggle.siblings('ul.tree-level').slideToggle(100);
        toggle.toggleClass('expanded collapsed');
        toggle.text(toggle.hasClass('expanded') ? '▼' : '▶');
    }

    function getIncludedPaths() {
        const paths = [];
        $('#file-tree input[type="checkbox"]:checked').each(function() {
            paths.push($(this).data('path'));
        });

        // Optimization: if a directory is included, we don't need to list its children
        const rootPaths = [];
        paths.sort();
        paths.forEach(path => {
            if (!rootPaths.some(root => path.startsWith(root + '/'))) {
                rootPaths.push(path);
            }
        });
        return rootPaths;
    }

    function copyOutputToClipboard() {
        const outputText = $('#output-text');
        outputText.select();
        document.execCommand('copy');
        const copyBtn = $('#copy-btn');
        const originalText = copyBtn.text();
        copyBtn.text('Copied!');
        setTimeout(() => copyBtn.text(originalText), 2000);
    }

    function showLoading(isLoading, message = "Loading...") {
        const indicator = $('#loading-indicator');
        if (isLoading) {
            indicator.find('p').text(message);
            indicator.removeClass('hidden');
        } else {
            indicator.addClass('hidden');
        }
    }

    function showProcessing(isProcessing) {
        const indicator = $('#processing-indicator');
        if (isProcessing) {
            indicator.removeClass('hidden');
        } else {
            indicator.addClass('hidden');
        }
    }

    function showError(message) {
        $('#error-message').text(message).removeClass('hidden');
    }

    function hideError() {
        $('#error-message').addClass('hidden');
    }

    function showConfig() {
        $('#config-section').removeClass('hidden');
    }

    function hideConfig() {
        $('#config-section').addClass('hidden');
    }

    function showOutput() {
        $('#output-section').removeClass('hidden');
    }

    function hideOutput() {
        $('#output-section').addClass('hidden');
    }
});
