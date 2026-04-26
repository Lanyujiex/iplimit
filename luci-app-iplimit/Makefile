include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-iplimit
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-3.0-or-later
PKG_MAINTAINER:=iplimit

LUCI_TITLE:=LuCI support for IP bandwidth limiting
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-iplimit/install
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-iplimit.json $(1)/usr/share/luci/menu.d/

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-iplimit.json $(1)/usr/share/rpcd/acl.d/

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/iplimit
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/iplimit/settings.js $(1)/www/luci-static/resources/view/iplimit/
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/iplimit/status.js $(1)/www/luci-static/resources/view/iplimit/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/iplimit.conf $(1)/etc/config/iplimit.conf

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/iplimit $(1)/etc/init.d/iplimit
endef

define Package/luci-app-iplimit/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	ln -sf /etc/config/iplimit.conf /etc/config/iplimit
	/etc/init.d/iplimit enable
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache*
}
exit 0
endef

define Package/luci-app-iplimit/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/iplimit stop
	/etc/init.d/iplimit disable
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-iplimit))
