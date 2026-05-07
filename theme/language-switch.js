(function () {
  function getSwitchTarget() {
    var path = window.location.pathname;
    var isChinese = path.indexOf("/typescript-zh/") !== -1;
    var from = isChinese ? "/typescript-zh/" : "/typescript/";
    var to = isChinese ? "/typescript/" : "/typescript-zh/";

    if (path.indexOf(from) === -1) return null;

    return {
      href: path.replace(from, to) + window.location.search + window.location.hash,
      label: isChinese ? "English" : "简体中文",
    };
  }

  function addLanguageSwitch() {
    var target = getSwitchTarget();
    if (!target) return;

    var menu = document.getElementById("mdbook-menu-bar");
    var rightButtons = menu && menu.querySelector(".right-buttons");
    if (!rightButtons || document.querySelector(".language-switch")) return;

    var link = document.createElement("a");
    link.className = "language-switch";
    link.href = target.href;
    link.textContent = target.label;
    link.setAttribute("aria-label", "Switch language");

    rightButtons.insertBefore(link, rightButtons.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addLanguageSwitch);
  } else {
    addLanguageSwitch();
  }
})();
