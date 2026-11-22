(() => {
    function initTheme() {
        const savedTheme = localStorage.getItem("theme");
        if (savedTheme === "dark") {
            document.body.classList.add("dark-mode");
        } else {
            document.body.classList.remove("dark-mode");
        }
    }

    // Run immediately when script loads to prevent flash
    initTheme();

    document.addEventListener("DOMContentLoaded", () => {
        // Find theme toggle buttons
        const toggleBtns = document.querySelectorAll(".theme-toggle");
        
        toggleBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                document.body.classList.toggle("dark-mode");
                if (document.body.classList.contains("dark-mode")) {
                    localStorage.setItem("theme", "dark");
                } else {
                    localStorage.setItem("theme", "light");
                }
            });
        });
    });
})();
