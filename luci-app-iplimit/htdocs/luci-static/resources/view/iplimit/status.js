'use strict';
'require view';
'require fs';
'require poll';
'require ui';

function renderStatus(running) {
    if (running) {
        return E('em', { 'class': 'spinning' }, _('Running'));
    } else {
        return E('em', {}, _('Stopped'));
    }
}

/* Parse tc -s class show output into array of objects */
function parseHtbClasses(stdout) {
    if (!stdout) return [];

    var classes = [];
    var blocks = stdout.split(/(?=class htb)/);

    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i].trim();
        if (!block || block.indexOf('class htb') !== 0) continue;

        var entry = {};

        /* class htb 1:1 root rate 1Gbit ceil 1Gbit ... */
        /* class htb 1:10 parent 1:1 leaf 100: prio 0 rate 20Mbit ceil 20Mbit ... */
        /* class htb 1:9999 parent 1:1 prio 0 rate 980Mbit ceil 1Gbit ... */
        var classMatch = block.match(/class htb\s+(\S+)/);
        entry.classid = classMatch ? classMatch[1] : '-';

        if (block.indexOf('root') !== -1) {
            entry.type = 'root';
        } else if (/:9999\b/.test(entry.classid)) {
            entry.type = 'default';
        } else if (/parent\s+\S+\s/.test(block) && !/root/.test(block) && /:1\b/.test(entry.classid)) {
            entry.type = 'root';
        } else {
            entry.type = 'host';
        }

        var rateMatch = block.match(/\brate\s+(\S+)/);
        entry.rate = rateMatch ? rateMatch[1] : '-';

        var ceilMatch = block.match(/\bceil\s+(\S+)/);
        entry.ceil = ceilMatch ? ceilMatch[1] : '-';

        /* Sent 12345 bytes 100 pkt (dropped 0, overlimits 0 requeues 0) */
        var sentMatch = block.match(/Sent\s+(\d+)\s+bytes\s+(\d+)\s+pkt/);
        entry.sent = sentMatch ? formatBytes(parseInt(sentMatch[1], 10)) : '0 B';
        entry.packets = sentMatch ? sentMatch[2] : '0';

        var droppedMatch = block.match(/dropped\s+(\d+)/);
        entry.dropped = droppedMatch ? droppedMatch[1] : '0';

        var overlimitsMatch = block.match(/overlimits\s+(\d+)/);
        entry.overlimits = overlimitsMatch ? overlimitsMatch[1] : '0';

        /* backlog 0b 0p */
        var backlogMatch = block.match(/backlog\s+(\S+)\s+(\d+)p/);
        entry.backlog = backlogMatch ? backlogMatch[1] : '0b';

        classes.push(entry);
    }

    return classes;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    var val = bytes;
    while (val >= 1024 && i < units.length - 1) {
        val = val / 1024;
        i++;
    }
    return val.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function renderTable(classes) {
    if (!classes || classes.length === 0) {
        return E('p', { 'style': 'opacity:0.5;' }, _('No data'));
    }

    var headerRow = E('tr', { 'class': 'tr table-titles' }, [
        E('th', { 'class': 'th' }, _('Class')),
        E('th', { 'class': 'th' }, _('Type')),
        E('th', { 'class': 'th' }, _('Rate')),
        E('th', { 'class': 'th' }, _('Ceil')),
        E('th', { 'class': 'th' }, _('Sent')),
        E('th', { 'class': 'th' }, _('Packets')),
        E('th', { 'class': 'th' }, _('Dropped')),
        E('th', { 'class': 'th' }, _('Overlimits'))
    ]);

    /* Sort: root → default → host (by classid asc) */
    classes.sort(function(a, b) {
        var order = { 'root': 0, 'default': 1, 'host': 2 };
        var oa = order[a.type] !== undefined ? order[a.type] : 9;
        var ob = order[b.type] !== undefined ? order[b.type] : 9;
        if (oa !== ob) return oa - ob;
        var na = parseInt((a.classid || '').replace(/.*:/, ''), 10) || 0;
        var nb = parseInt((b.classid || '').replace(/.*:/, ''), 10) || 0;
        return na - nb;
    });

    var rows = [headerRow];
    for (var i = 0; i < classes.length; i++) {
        var c = classes[i];
        var rowStyle = '';
        if (c.type === 'root') rowStyle = 'font-weight:bold;opacity:0.7;';
        else if (c.type === 'default') rowStyle = 'font-style:italic;opacity:0.8;';

        var typeLabel = c.type === 'root' ? 'Root' : (c.type === 'default' ? 'Default' : 'Host');

        rows.push(E('tr', { 'class': 'tr', 'style': rowStyle }, [
            E('td', { 'class': 'td' }, c.classid),
            E('td', { 'class': 'td' }, typeLabel),
            E('td', { 'class': 'td' }, c.rate),
            E('td', { 'class': 'td' }, c.ceil),
            E('td', { 'class': 'td' }, c.sent),
            E('td', { 'class': 'td' }, c.packets),
            E('td', { 'class': 'td' }, c.dropped),
            E('td', { 'class': 'td' }, c.overlimits)
        ]));
    }

    return E('table', { 'class': 'table cbi-section-table' }, rows);
}

return view.extend({
    load: function() {
        return Promise.all([
            fs.exec('/etc/init.d/iplimit', ['status']).catch(function() { return { code: 1, stdout: '', stderr: '' }; }),
            fs.exec('/sbin/tc', ['-s', 'class', 'show', 'dev', 'br-lan']).catch(function() { return { code: 1, stdout: '', stderr: '' }; }),
            fs.exec('/sbin/tc', ['-s', 'class', 'show', 'dev', 'ifb0']).catch(function() { return { code: 1, stdout: '', stderr: '' }; })
        ]);
    },

    pollData: function() {
        return Promise.all([
            fs.exec('/sbin/tc', ['-s', 'class', 'show', 'dev', 'br-lan']).catch(function() { return { code: 1, stdout: '', stderr: '' }; }),
            fs.exec('/sbin/tc', ['-s', 'class', 'show', 'dev', 'ifb0']).catch(function() { return { code: 1, stdout: '', stderr: '' }; })
        ]).then(function(results) {
            var dlContainer = document.getElementById('iplimit-dl-table');
            var ulContainer = document.getElementById('iplimit-ul-table');
            var statusContainer = document.getElementById('iplimit-status-badge');

            if (dlContainer) {
                while (dlContainer.firstChild) dlContainer.removeChild(dlContainer.firstChild);
                dlContainer.appendChild(renderTable(parseHtbClasses(results[0].stdout)));
            }
            if (ulContainer) {
                while (ulContainer.firstChild) ulContainer.removeChild(ulContainer.firstChild);
                ulContainer.appendChild(renderTable(parseHtbClasses(results[1].stdout)));
            }
            if (statusContainer) {
                var running = (results[0].stdout || '').indexOf('class htb') !== -1;
                while (statusContainer.firstChild) statusContainer.removeChild(statusContainer.firstChild);
                statusContainer.appendChild(renderStatus(running));
            }
        });
    },

    render: function(results) {
        var statusOutput = results[0] || {};
        var dlStats = results[1] || {};
        var ulStats = results[2] || {};

        var isRunning = (dlStats.stdout || '').indexOf('class htb') !== -1;

        var dlClasses = parseHtbClasses(dlStats.stdout);
        var ulClasses = parseHtbClasses(ulStats.stdout);

        /* Config Overview: collapsible, raw unfiltered data */
        var configContent = E('pre', {
            'id': 'iplimit-config',
            'style': 'overflow-x:auto;font-size:12px;margin-top:8px;'
        }, statusOutput.stdout || _('No data'));

        var configSection = E('div', { 'class': 'cbi-section' }, [
            E('h3', {
                'style': 'cursor:pointer;user-select:none;',
                'click': function() {
                    var content = configContent;
                    var arrow = this.querySelector('.arrow');
                    if (content.style.display === 'none') {
                        content.style.display = '';
                        if (arrow) arrow.textContent = '\u25BC ';
                    } else {
                        content.style.display = 'none';
                        if (arrow) arrow.textContent = '\u25B6 ';
                    }
                }
            }, [
                E('span', { 'class': 'arrow' }, '\u25B6 '),
                _('Config Overview (Raw)')
            ]),
            configContent
        ]);

        /* Start collapsed */
        configContent.style.display = 'none';

        var v = E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('IP Limit - Status')),

            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Service Status')),
                E('div', { 'style': 'display:flex;align-items:center;gap:12px;padding:8px 0;' }, [
                    E('strong', {}, _('Status') + ':'),
                    E('span', { 'id': 'iplimit-status-badge' }, renderStatus(isRunning)),
                    E('button', {
                        'class': 'cbi-button cbi-button-action important',
                        'click': function() {
                            return fs.exec('/etc/init.d/iplimit', ['restart']).then(function() {
                                ui.addNotification(null, E('p', _('Service restarted.')), 'info');
                            });
                        }
                    }, _('Restart')),
                    E('button', {
                        'class': 'cbi-button cbi-button-negative',
                        'click': function() {
                            return fs.exec('/etc/init.d/iplimit', ['stop']).then(function() {
                                ui.addNotification(null, E('p', _('Service stopped.')), 'info');
                            });
                        }
                    }, _('Stop'))
                ])
            ]),

            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Download Rules (br-lan)')),
                E('div', { 'id': 'iplimit-dl-table' }, renderTable(dlClasses))
            ]),

            E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Upload Rules (ifb0)')),
                E('div', { 'id': 'iplimit-ul-table' }, renderTable(ulClasses))
            ]),

            configSection
        ]);

        poll.add(L.bind(this.pollData, this), 5);

        return v;
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
