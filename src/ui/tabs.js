// Tab switching for tabbed panes.

export function bindTabs(root) {
    root.off('click.tabs').on('click.tabs', '.npcb-tab', (e) => {
        const tab = $(e.currentTarget);
        const bar = tab.closest('.npcb-tabs');
        bar.find('.npcb-tab').removeClass('active');
        tab.addClass('active');
        const scope = bar.parent();
        scope.children('.npcb-tabpane').hide();
        scope.children(`.npcb-tabpane[data-pane="${tab.data('tab')}"]`).show();
    });
}
