(function initializeSequencerUi(root) {
    "use strict";

    function getScoringAboutText() {
        return [
            "Answers can receive partial credit. The scoring algorithm analyzes adjacent pairs for correctness, event order precedence, and Spearman's rho to summarize overall order.",
            "Files with missing, extra, or duplicated events are flagged during analysis so instructors can review those submissions separately."
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

        dropZone.addEventListener("click", () => input.click());
        dropZone.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                input.click();
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
            const droppedFiles = Array.from(event.dataTransfer.files || [])
                .filter(file => file.name.toLowerCase().endsWith(".seq"));
            const files = multiple ? droppedFiles : droppedFiles.slice(0, 1);

            if (files.length === 0) {
                input.value = "";
                setDropZoneStatus(dropZone, "No .seq file selected");
                return;
            }

            if (!setInputFiles(input, files)) {
                setDropZoneStatus(dropZone, "Choose file instead");
                return;
            }

            setDropZoneStatus(dropZone, formatFileStatus(files));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });

        input.addEventListener("change", () => {
            const files = Array.from(input.files || []);
            setDropZoneStatus(dropZone, files.length > 0 ? formatFileStatus(files) : "No file selected");
        });
    }

    function setInputFiles(input, files) {
        if (typeof DataTransfer === "undefined") {
            return false;
        }

        const dataTransfer = new DataTransfer();
        files.forEach(file => dataTransfer.items.add(file));
        input.files = dataTransfer.files;
        return true;
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
            input.value = "";
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
        openAboutDialog,
        openTermsDialog,
        setupDropZone
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
