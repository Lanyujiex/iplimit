'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require ui';

var mapInstance;

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('iplimit')
        ]);
    },

    render: function() {
        var m, s, o;

        m = new form.Map('iplimit', _('IP Limit'),
            _('Per-IP bandwidth control based on tc HTB + ifb.'));

        mapInstance = m;

        // Global settings
        s = m.section(form.NamedSection, 'globals', 'globals', _('Global Settings'));
        s.anonymous = false;
        s.addremove = false;

        o = s.option(form.Flag, 'enabled', _('Enable'));
        o.default = '0';
        o.rmempty = false;

        o = s.option(form.Value, 'iface', _('Interface'),
            _('Network interface for traffic control.'));
        o.default = 'br-lan';
        o.rmempty = false;

        o = s.option(form.Value, 'total_bandwidth', _('Total Bandwidth'),
            _('Total available bandwidth, e.g. 1000mbit, 500mbit.'));
        o.default = '1000mbit';
        o.rmempty = false;

        // Host rules
        s = m.section(form.GridSection, 'host', _('Host Rules'));
        s.anonymous = true;
        s.addremove = true;
        s.sortable = true;
        s.addbtntitle = _('Add Host');
        s.modaltitle = _('Edit Host');

        o = s.option(form.Flag, 'enabled', _('Enable'));
        o.default = '1';
        o.rmempty = false;
        o.editable = true;

        o = s.option(form.Value, 'name', _('Name'));
        o.optional = true;
        o.editable = true;

        o = s.option(form.Value, 'ip', _('IP Address'));
        o.datatype = 'ipaddr';
        o.optional = false;
        o.editable = true;

        o = s.option(form.Value, 'download', _('Download'));
        o.optional = false;
        o.editable = true;
        o.validate = function(section_id, value) {
            if (!value) return true;
            if (!/^\d+(kbit|mbit|gbit)$/i.test(value))
                return _('Format: number + unit (kbit/mbit/gbit)');
            return true;
        };

        o = s.option(form.ListValue, 'download_mode', _('DL Mode'));
        o.value('ceil', _('Limit'));
        o.value('rate', _('Guard'));
        o.default = 'ceil';
        o.editable = true;

        o = s.option(form.Value, 'upload', _('Upload'));
        o.optional = false;
        o.editable = true;
        o.validate = function(section_id, value) {
            if (!value) return true;
            if (!/^\d+(kbit|mbit|gbit)$/i.test(value))
                return _('Format: number + unit (kbit/mbit/gbit)');
            return true;
        };

        o = s.option(form.ListValue, 'upload_mode', _('UL Mode'));
        o.value('ceil', _('Limit'));
        o.value('rate', _('Guard'));
        o.default = 'ceil';
        o.editable = true;

        return m.render();
    },

    handleSaveApply: function(ev, mode) {
        return this._saveAndRestart();
    },

    handleSave: null,

    _saveAndRestart: function() {
        return mapInstance.save()
            .then(function() {
                return uci.apply();
            })
            .then(function() {
                return new Promise(function(resolve) {
                    window.setTimeout(resolve, 2000);
                });
            })
            .then(function() {
                return fs.exec('/etc/init.d/iplimit', ['restart']);
            })
            .then(function() {
                ui.changes.setIndicator(0);
                ui.addNotification(null, E('p', _('Configuration saved. Service restarted.')), 'info');
            })
            .catch(function(e) {
                ui.addNotification(null, E('p', _('Failed: ') + e.message));
            });
    },

    handleReset: null
});
