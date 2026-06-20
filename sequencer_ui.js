(function initializeSequencerUi(root) {
    "use strict";

    const selectedFileStore = new WeakMap();

    function getScoringAboutText() {
        return [
            "Answers can receive partial credit. The scoring algorithm analyzes adjacent-pair accuracy and element order precedence to summarize overall order.",
            "Class reports identify recurring sequence-ordering segments and relationship errors. Files with missing, extra, or duplicated elements are flagged separately."
        ];
    }

    function ensureAboutDialog() {
        let dialog = document.getElementById("aboutDialog");

        if (dialog) {
            return dialog;
        }

        dialog = document.createElement("dialog");
        dialog.id = "aboutDialog";
        dialog.className = "about-dialog";

        const title = document.createElement("h2");
        title.id = "aboutDialogTitle";
        title.textContent = "About Sequencer Scoring";
        dialog.setAttribute("aria-labelledby", title.id);

        const content = document.createElement("div");
        content.className = "about-dialog-content";

        getScoringAboutText().forEach(text => {
            const paragraph = document.createElement("p");
            paragraph.textContent = text;
            content.appendChild(paragraph);
        });

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.textContent = "Close";
        closeButton.addEventListener("click", closeAboutDialog);

        dialog.appendChild(title);
        dialog.appendChild(content);
        dialog.appendChild(closeButton);
        document.body.appendChild(dialog);

        dialog.addEventListener("click", event => {
            if (event.target === dialog) {
                closeAboutDialog();
            }
        });

        return dialog;
    }

    function openAboutDialog() {
        const dialog = ensureAboutDialog();

        if (typeof dialog.showModal === "function") {
            dialog.showModal();
            return;
        }

        dialog.setAttribute("open", "");
    }

    function closeAboutDialog() {
        const dialog = document.getElementById("aboutDialog");

        if (!dialog) {
            return;
        }

        if (typeof dialog.close === "function") {
            dialog.close();
            return;
        }

        dialog.removeAttribute("open");
    }

    function ensureTermsDialog() {
        let dialog = document.getElementById("termsDialog");

        if (dialog) {
            return dialog;
        }

        dialog = document.createElement("dialog");
        dialog.id = "termsDialog";
        dialog.className = "terms-dialog";

        const title = document.createElement("h2");
        title.id = "termsDialogTitle";
        title.textContent = "Terms of Service";
        dialog.setAttribute("aria-labelledby", title.id);

        const frame = document.createElement("iframe");
        frame.src = "Terms_of_Service.html";
        frame.title = "Sequencer Terms of Service";

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.textContent = "Close";
        closeButton.addEventListener("click", closeTermsDialog);

        dialog.appendChild(title);
        dialog.appendChild(frame);
        dialog.appendChild(closeButton);
        document.body.appendChild(dialog);

        dialog.addEventListener("click", event => {
            if (event.target === dialog) {
                closeTermsDialog();
            }
        });

        return dialog;
    }

    function openTermsDialog() {
        const dialog = ensureTermsDialog();

        if (typeof dialog.showModal === "function") {
            dialog.showModal();
            return;
        }

        dialog.setAttribute("open", "");
    }

    function closeTermsDialog() {
        const dialog = document.getElementById("termsDialog");

        if (!dialog) {
            return;
        }

        if (typeof dialog.close === "function") {
            dialog.close();
            return;
        }

        dialog.removeAttribute("open");
    }

    function setupDropZone(options) {
        const dropZone = document.getElementById(options.dropZoneId);
        const input = document.getElementById(options.inputId);

        if (!dropZone || !input) {
            return;
        }

        const multiple = Boolean(options.multiple);
        const statusElement = getDropZoneStatusElement(dropZone);

        if (statusElement) {
            statusElement.setAttribute("role", "status");
            statusElement.setAttribute("aria-live", "polite");

            if (!statusElement.id) {
                statusElement.id = `${options.dropZoneId}Status`;
            }

            if (!dropZone.hasAttribute("aria-describedby")) {
                dropZone.setAttribute("aria-describedby", statusElement.id);
            }
        }

        dropZone.addEventListener("click", () => openFilePicker(input, dropZone, multiple, options.pickerId));
        dropZone.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openFilePicker(input, dropZone, multiple, options.pickerId);
            }
        });

        ["dragenter", "dragover"].forEach(eventName => {
            dropZone.addEventListener(eventName, event => {
                event.preventDefault();
                dropZone.classList.add("drag-over");
            });
        });

        ["dragleave", "drop"].forEach(eventName => {
            dropZone.addEventListener(eventName, event => {
                event.preventDefault();
                dropZone.classList.remove("drag-over");
            });
        });

        dropZone.addEventListener("drop", event => {
            event.preventDefault();
            const droppedFiles = Array.from(event.dataTransfer?.files || [])
                .filter(file => file.name.toLowerCase().endsWith(".seq"));
            const files = multiple ? droppedFiles : droppedFiles.slice(0, 1);

            if (files.length === 0) {
                clearInputFiles(input);
                setDropZoneStatus(dropZone, "No .seq file selected");
                return;
            }

            applySelectedFiles(input, files);
            setDropZoneStatus(dropZone, formatFileStatus(files));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });

        input.addEventListener("change", event => {
            const inputFiles = Array.from(input.files || []);

            if (event.isTrusted || inputFiles.length > 0 || !selectedFileStore.has(input)) {
                storeSelectedFiles(input, inputFiles);
            }

            const files = getSelectedFiles(input);
            setDropZoneStatus(dropZone, files.length > 0 ? formatFileStatus(files) : "No file selected");
        });
    }

    async function openFilePicker(input, dropZone, multiple, pickerId) {
        if (!pickerId || typeof window.showOpenFilePicker !== "function" || !window.isSecureContext) {
            input.click();
            return;
        }

        try {
            const handles = await window.showOpenFilePicker({
                id: pickerId,
                multiple,
                excludeAcceptAllOption: true,
                types: [
                    {
                        description: "Sequencer files",
                        accept: {
                            "application/json": [".seq"]
                        }
                    }
                ]
            });
            const files = await Promise.all(handles.map(handle => handle.getFile()));

            applySelectedFiles(input, files);
            setDropZoneStatus(dropZone, formatFileStatus(files));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (error) {
            if (error?.name !== "AbortError") {
                console.warn("The remembered-location file picker could not be opened.", error);
                input.click();
            }
        }
    }

    function applySelectedFiles(input, files) {
        storeSelectedFiles(input, files);
        setInputFiles(input, files);
    }

    function storeSelectedFiles(input, files) {
        const fileArray = Array.from(files || []);

        if (fileArray.length > 0) {
            selectedFileStore.set(input, fileArray);
            return;
        }

        selectedFileStore.delete(input);
    }

    function setInputFiles(input, files) {
        if (typeof DataTransfer === "undefined") {
            return false;
        }

        try {
            const dataTransfer = new DataTransfer();
            files.forEach(file => dataTransfer.items.add(file));
            input.files = dataTransfer.files;
            return Array.from(input.files || []).length === files.length;
        } catch (error) {
            return false;
        }
    }

    function clearInputFiles(input) {
        selectedFileStore.delete(input);

        try {
            input.value = "";
        } catch (error) {
            // Some browsers restrict file input mutation. The fallback store is already clear.
        }
    }

    function getSelectedFiles(inputOrId) {
        const input = typeof inputOrId === "string"
            ? document.getElementById(inputOrId)
            : inputOrId;

        if (!input) {
            return [];
        }

        if (selectedFileStore.has(input)) {
            return [...selectedFileStore.get(input)];
        }

        return Array.from(input.files || []);
    }

    function setDropZoneStatus(dropZone, status) {
        const statusElement = getDropZoneStatusElement(dropZone);

        if (statusElement) {
            statusElement.textContent = status;
        }
    }

    function getDropZoneStatusElement(dropZone) {
        const describedById = dropZone.getAttribute("aria-describedby");

        if (describedById) {
            const describedElement = document.getElementById(describedById);

            if (describedElement && describedElement.matches("[data-drop-status]")) {
                return describedElement;
            }
        }

        return dropZone.querySelector("[data-drop-status]");
    }

    function formatFileStatus(files) {
        if (files.length === 1) {
            return files[0].name;
        }

        return `${files.length} files selected`;
    }

    function clearFileSelection(inputId, dropZoneId, emptyStatus) {
        const input = document.getElementById(inputId);
        const dropZone = document.getElementById(dropZoneId);

        if (input) {
            clearInputFiles(input);
        }

        if (dropZone) {
            setDropZoneStatus(dropZone, emptyStatus || "No file selected");
            dropZone.classList.remove("drag-over");
        }
    }

    root.SequencerUI = {
        clearFileSelection,
        closeAboutDialog,
        closeTermsDialog,
        getSelectedFiles,
        openAboutDialog,
        openTermsDialog,
        setupDropZone
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
