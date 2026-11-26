const tabList = document.querySelector("[data-feature-tabs]");
const tabs = Array.from(tabList.querySelectorAll("button"));
const panels = tabs.map((tab) => document.getElementById(tab.dataset.panel));

function selectTab(selected) {
  tabs.forEach((tab, index) => {
    const active = index === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    panels[index].hidden = !active;
  });
}

tabList.setAttribute("role", "tablist");
tabList.setAttribute("aria-label", "SolveMate 功能");
tabs.forEach((tab, index) => {
  const panel = panels[index];
  tab.id = `tab-${panel.id}`;
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", panel.id);
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", tab.id);
  tab.addEventListener("click", () => selectTab(index));
  tab.addEventListener("keydown", (event) => {
    const target = {
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    selectTab(target);
    tabs[target].focus();
  });
});
const linkedPanel = panels.findIndex(
  (panel) => `#${panel.id}` === location.hash,
);
selectTab(Math.max(0, linkedPanel));
tabList.hidden = false;
