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
        const rootContentHtml = buildTreeHtml(tree);

        const treeHtml = `
            <ul class="tree-level">
                <li>
                    <span class="toggle expanded">▼</span>
                    <input type="checkbox" id="cb-root" data-path="" checked>
                    <label for="cb-root">/ (Repository Root)</label>
                    ${rootContentHtml}
                </li>
            </ul>`;

        $('#file-tree').html(treeHtml);
    }

    function buildTreeObject(files) {
        const root = { _files: [] };
        files.forEach(file => {
            const parts = file.path.split('/');
            let currentNode = root;

            parts.forEach((part, index) => {
                if (index === parts.length - 1) {
                    currentNode._files.push({ name: part, path: file.path });
                } else {
                    if (!currentNode[part]) {
                        currentNode[part] = { _files: [] };
                    }
                    currentNode = currentNode[part];
                }
            });
        });
        return root;
    }

    function buildTreeHtml(node, pathPrefix = '') {
        if (!node) return '';

        let html = '<ul class="tree-level">';

        const directoryKeys = Object.keys(node).filter(k => k !== '_files').sort();
        directoryKeys.forEach(key => {
            const directoryNode = node[key];
            const currentPath = pathPrefix ? `${pathPrefix}/${key}` : key;

            html += `<li>`;
            html += `<span class="toggle collapsed">▶</span>`;
            html += `<input type="checkbox" id="cb-${currentPath}" data-path="${currentPath}" checked>`;
            html += `<label for="cb-${currentPath}">${key}</label>`;

            const childHtml = buildTreeHtml(directoryNode, currentPath);
            const styledChildHtml = childHtml.replace('<ul class="tree-level">', '<ul class="tree-level" style="display: none;">');
            html += styledChildHtml;

            html += `</li>`;
        });

        if (node._files) {
            node._files.sort((a, b) => a.name.localeCompare(b.name)).forEach(file => {
                html += `<li>`;
                html += `<span class="toggle-placeholder"></span>`;
                html += `<input type="checkbox" id="cb-${file.path}" data-path="${file.path}" checked>`;
                html += `<label for="cb-${file.path}">${file.name}</label>`;
                html += `</li>`;
            });
        }

        html += '</ul>';
        return html;
    }

    // --- UI State Management (NEW & IMPROVED) ---

    function handleCheckboxChange(e) {
        const checkbox = $(e.target);
        const isChecked = checkbox.prop('checked');

        // Part 1: Top-Down - Update all children recursively
        const descendants = checkbox.closest('li').find('input[type="checkbox"]');
        descendants.prop('checked', isChecked);
        descendants.prop('indeterminate', false); // A direct action removes ambiguity

        // Part 2: Bottom-Up - Update all parents recursively
        updateAncestors(checkbox);
    }

    function updateAncestors(checkbox) {
        const parentLi = checkbox.closest('ul').closest('li');
        if (parentLi.length === 0) {
            return; // Reached the root, stop.
        }

        const parentCheckbox = parentLi.find('> input[type="checkbox"]');
        const childrenCheckboxes = parentLi.find('> ul > li > input[type="checkbox"]');

        const totalChildren = childrenCheckboxes.length;
        if (totalChildren === 0) {
            updateAncestors(parentCheckbox); // Continue up the chain
            return;
        }

        const checkedChildren = childrenCheckboxes.filter(':checked').length;
        const indeterminateChildren = childrenCheckboxes.filter(function() {
            return this.indeterminate;
        }).length;

        if (checkedChildren === 0 && indeterminateChildren === 0) {
            // All children are unchecked
            parentCheckbox.prop('checked', false);
            parentCheckbox.prop('indeterminate', false);
        } else if (checkedChildren === totalChildren) {
            // All children are fully checked
            parentCheckbox.prop('checked', true);
            parentCheckbox.prop('indeterminate', false);
        } else {
            // A mix of states
            parentCheckbox.prop('checked', false); // Not fully checked
            parentCheckbox.prop('indeterminate', true);
        }

        updateAncestors(parentCheckbox); // Recurse
    }

    function handleTreeToggle(e) {
        const toggle = $(e.target);
        toggle.siblings('ul.tree-level').slideToggle(100);
        toggle.toggleClass('expanded collapsed');
        toggle.text(toggle.hasClass('expanded') ? '▼' : '▶');
    }

    function getIncludedPaths() {
        const paths = [];
        // Only add paths that are explicitly checked.
        // The tri-state logic means indeterminate parents are not 'checked'.
        $('#file-tree input[type="checkbox"]:checked').each(function() {
            paths.push($(this).data('path'));
        });

        // Optimization: if the root is checked, we just need its path ("")
        if (paths.includes("")) {
            return [""];
        }

        const rootPaths = [];
        paths.sort();
        // This logic correctly simplifies the list, e.g., if 'src' is included,
        // it won't also include 'src/main.py'.
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
