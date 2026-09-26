const Applet = imports.ui.applet;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Pango = imports.gi.Pango;

const UUID = "claude-usage-alert@lisandius";
const STATE_DIR = GLib.build_filenamev([GLib.get_home_dir(), ".local", "state", "claude-usage-alert"]);
const STATE_FILE = GLib.build_filenamev([STATE_DIR, "applet-state.json"]);
const POPUP_WIDTH = 340;
const STALE_SECONDS = 60;
const CLAUDE_TIMEOUT_SECONDS = 60;

const TEXT = {
    en: {
        title: "Claude Code plan usage",
        session: "Session",
        week: "Week (all models)",
        used: "used",
        resets: "Resets",
        sessionHelp: "A rolling usage window that counts everything you do with Claude — Claude Code and claude.ai, on every device. It is not a single conversation. When it resets, the counter starts from zero.",
        weekHelp: "The weekly limit across all models. Like the session, it is shared by all your devices and apps.",
        otherHelp: "An additional limit reported by Claude Code.",
        legend: "Colours: green below %1%, yellow from %1%, red from %2%.",
        local: "This machine (approximate)",
        updated: "Updated %1 · source: claude /usage",
        refresh: "Refresh now",
        settings: "Settings",
        loading: "Loading…",
        error: "Could not read usage",
        errorHelp: "Check that Claude Code is installed and logged in, and that the path in the settings is right.",
        notifySession: "Claude Code: %1% of the session limit",
        notifyWeek: "Claude Code: %1% of the weekly limit",
        notifyBody: "Used %1%. Resets: %2",
        testTitle: "Claude Usage Alert",
        testBody: "Notifications work.",
        prefixSession: "S",
        prefixWeek: "W",
    },
    ru: {
        title: "Лимиты Claude Code",
        session: "Сессия",
        week: "Неделя (все модели)",
        used: "использовано",
        resets: "Сброс",
        sessionHelp: "Скользящее окно лимита, которое считает всё ваше использование Claude — Claude Code и claude.ai, на всех устройствах. Это не одна беседа. После сброса счётчик начинается с нуля.",
        weekHelp: "Недельный лимит по всем моделям. Как и сессия, общий для всех ваших устройств и приложений.",
        otherHelp: "Дополнительный лимит, который сообщает Claude Code.",
        legend: "Цвета: зелёный до %1%, жёлтый от %1%, красный от %2%.",
        local: "Эта машина (приблизительно)",
        updated: "Обновлено %1 · источник: claude /usage",
        refresh: "Обновить сейчас",
        settings: "Настройки",
        loading: "Загрузка…",
        error: "Не удалось прочитать лимиты",
        errorHelp: "Проверьте, что Claude Code установлен и вы залогинены, и что путь в настройках верный.",
        notifySession: "Claude Code: %1% лимита сессии",
        notifyWeek: "Claude Code: %1% недельного лимита",
        notifyBody: "Использовано %1%. Сброс: %2",
        testTitle: "Claude Usage Alert",
        testBody: "Уведомления работают.",
        prefixSession: "С",
        prefixWeek: "Н",
    },
};

const ROW_RE = /^Current ([^:\n]+?):\s*(\d+)%\s*used(?:\s*[·•]\s*resets\s*(.+?))?\s*$/gm;

function fmt(template, ...args) {
    return template.replace(/%(\d)/g, (_m, n) => String(args[Number(n) - 1]));
}

function toHex(color) {
    let m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
    if (m) {
        return "#" + [m[1], m[2], m[3]].map(v => Number(v).toString(16).padStart(2, "0")).join("");
    }
    return color;
}

function parseThresholds(text) {
    return String(text).split(",").map(s => parseInt(s.trim(), 10)).filter(n => n > 0 && n <= 100).sort((a, b) => a - b);
}

function rowKind(name) {
    if (name === "session") return "session";
    if (name === "week (all models)") return "week";
    return "other";
}

function parseUsage(output) {
    let rows = [];
    let m;
    ROW_RE.lastIndex = 0;
    while ((m = ROW_RE.exec(output)) !== null) {
        rows.push({
            name: m[1].trim(),
            kind: rowKind(m[1].trim().toLowerCase()),
            pct: parseInt(m[2], 10),
            resets: (m[3] || "").trim(),
        });
    }
    let detail = "";
    let idx = output.indexOf("What's contributing");
    if (idx >= 0) {
        let lines = output.slice(idx).split("\n").slice(1).map(l => l.trimEnd());
        detail = lines.join("\n").trim();
    }
    return { rows, detail };
}

class ClaudeUsageApplet extends Applet.TextApplet {
    constructor(orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.usage = null;
        this.errorText = null;
        this.updatedAt = null;
        this.fetching = false;
        this.timerId = 0;
        this.fetchedAtMonotonic = 0;
        this.notifyState = this._loadState();

        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        for (let key of [
            "refresh-minutes", "claude-path", "language", "label-mode", "show-prefixes",
            "warn-threshold", "crit-threshold", "color-ok", "color-warn", "color-crit",
            "notify-enabled", "session-thresholds", "week-thresholds",
        ]) {
            this.settings.bind(key, key.replace(/-/g, "_"), this._onSettingsChanged.bind(this));
        }

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.contentBox = new St.BoxLayout({ vertical: true, style: "spacing: 10px; padding: 8px 14px; width: " + POPUP_WIDTH + "px;" });
        this.menu.addActor(this.contentBox);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.refreshItem = this.menu.addAction("", () => this.refresh());
        this.settingsItem = this.menu.addAction("", () => this.configureApplet());

        this.set_applet_tooltip("Claude Code");
        this._render();
        this.refresh();
        this._schedule();
    }

    get t() {
        let lang = this.language;
        if (lang !== "en" && lang !== "ru") {
            let names = GLib.get_language_names();
            lang = names.some(n => n.startsWith("ru")) ? "ru" : "en";
        }
        return TEXT[lang];
    }

    on_applet_clicked() {
        this.menu.toggle();
        if (this.menu.isOpen && this._ageSeconds() > STALE_SECONDS) {
            this.refresh();
        }
    }

    on_applet_removed_from_panel() {
        if (this.timerId) {
            Mainloop.source_remove(this.timerId);
            this.timerId = 0;
        }
        this.settings.finalize();
    }

    on_test_notification() {
        this._notify(this.t.testTitle, this.t.testBody, "normal");
    }

    _onSettingsChanged() {
        this._schedule();
        this._render();
    }

    _schedule() {
        if (this.timerId) {
            Mainloop.source_remove(this.timerId);
        }
        let seconds = Math.max(1, this.refresh_minutes) * 60;
        this.timerId = Mainloop.timeout_add_seconds(seconds, () => {
            this.refresh();
            return true;
        });
    }

    _ageSeconds() {
        return this.updatedAt ? (GLib.get_monotonic_time() - this.fetchedAtMonotonic) / 1e6 : Infinity;
    }

    _resolveClaude() {
        if (this.claude_path && this.claude_path.trim()) {
            return this.claude_path.trim();
        }
        return GLib.find_program_in_path("claude")
            || GLib.build_filenamev([GLib.get_home_dir(), ".local", "bin", "claude"]);
    }

    refresh() {
        if (this.fetching) {
            return;
        }
        this.fetching = true;
        let proc;
        try {
            GLib.mkdir_with_parents(STATE_DIR, 0o755);
            let launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
            });
            launcher.set_cwd(STATE_DIR);
            proc = launcher.spawnv([this._resolveClaude(), "-p", "/usage", "--no-session-persistence"]);
        } catch (e) {
            this._onFetched(null, String(e.message || e));
            return;
        }

        let killer = Mainloop.timeout_add_seconds(CLAUDE_TIMEOUT_SECONDS, () => {
            killer = 0;
            proc.force_exit();
            return false;
        });

        proc.communicate_utf8_async(null, null, (p, res) => {
            if (killer) {
                Mainloop.source_remove(killer);
            }
            try {
                let [, stdout] = p.communicate_utf8_finish(res);
                this._onFetched(stdout, null);
            } catch (e) {
                this._onFetched(null, String(e.message || e));
            }
        });
    }

    _onFetched(output, failure) {
        this.fetching = false;
        let parsed = output ? parseUsage(output) : null;
        if (parsed && parsed.rows.length > 0) {
            this.usage = parsed;
            this.errorText = null;
            this.updatedAt = GLib.DateTime.new_now_local();
            this.fetchedAtMonotonic = GLib.get_monotonic_time();
            this._checkNotifications(parsed.rows);
        } else {
            this.errorText = failure || (output ? output.trim().split("\n")[0] : "") || "no output";
        }
        this._render();
    }

    _levelColor(pct) {
        if (pct >= this.crit_threshold) return this.color_crit;
        if (pct >= this.warn_threshold) return this.color_warn;
        return this.color_ok;
    }

    _row(kind) {
        return this.usage ? this.usage.rows.find(r => r.kind === kind) : null;
    }

    _render() {
        this._renderLabel();
        this._renderPopup();
        this.refreshItem.label.set_text(this.t.refresh);
        this.settingsItem.label.set_text(this.t.settings);
    }

    _renderLabel() {
        let label = this._applet_label.clutter_text;
        let session = this._row("session");
        let week = this._row("week");
        if (!this.usage || (!session && !week)) {
            label.set_markup('<span foreground="#888a85">Claude ' + (this.errorText ? "?" : "…") + "</span>");
            this.set_applet_tooltip(this.errorText ? this.t.error : this.t.loading);
            return;
        }

        let part = (row, prefixKey) => {
            let prefix = this.show_prefixes ? this.t[prefixKey] + " " : "";
            return prefix + '<span foreground="' + toHex(this._levelColor(row.pct)) + '"><b>' + row.pct + "%</b></span>";
        };
        let parts = [];
        if (this.label_mode === "max") {
            let rows = [session, week].filter(Boolean);
            let top = rows.reduce((a, b) => (b.pct > a.pct ? b : a));
            parts.push(part(top, top.kind === "session" ? "prefixSession" : "prefixWeek"));
        } else {
            if (session && this.label_mode !== "week") parts.push(part(session, "prefixSession"));
            if (week && this.label_mode !== "session") parts.push(part(week, "prefixWeek"));
        }
        label.set_markup(parts.join("  "));

        let tip = [];
        if (session) tip.push(this.t.session + ": " + session.pct + "%");
        if (week) tip.push(this.t.week + ": " + week.pct + "%");
        this.set_applet_tooltip(tip.join("\n"));
    }

    _label(text, style, wrap) {
        let l = new St.Label({ text: text, style: (style || "") + " max-width: " + POPUP_WIDTH + "px;" });
        if (wrap) {
            l.clutter_text.line_wrap = true;
            l.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            l.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        }
        return l;
    }

    _bar(pct, color) {
        let track = new St.BoxLayout({
            style: "background-color: rgba(128,128,128,0.35); border-radius: 4px; height: 8px; width: " + (POPUP_WIDTH - 8) + "px;",
        });
        let fill = new St.Bin({
            style: "background-color: " + color + "; border-radius: 4px; width: " + Math.round((POPUP_WIDTH - 8) * Math.min(pct, 100) / 100) + "px;",
        });
        track.add_actor(fill);
        return track;
    }

    _renderPopup() {
        this.contentBox.destroy_all_children();
        let t = this.t;
        this.contentBox.add_actor(this._label(t.title, "font-weight: bold; font-size: 110%;"));

        if (!this.usage) {
            this.contentBox.add_actor(this._label(this.errorText ? t.error : t.loading, "", true));
            if (this.errorText) {
                this.contentBox.add_actor(this._label(this.errorText, "color: " + this.color_crit + ";", true));
                this.contentBox.add_actor(this._label(t.errorHelp, "font-size: 90%;", true));
            }
            return;
        }

        for (let row of this.usage.rows) {
            let color = this._levelColor(row.pct);
            let block = new St.BoxLayout({ vertical: true, style: "spacing: 3px;" });
            let name = row.kind === "session" ? t.session : row.kind === "week" ? t.week : row.name;
            let head = new St.BoxLayout({});
            head.add(this._label(name, "font-weight: bold;"), { expand: true });
            head.add_actor(this._label(row.pct + "% " + t.used, "font-weight: bold; color: " + color + ";"));
            block.add_actor(head);
            block.add_actor(this._bar(row.pct, color));
            if (row.resets) {
                block.add_actor(this._label(t.resets + ": " + row.resets, "font-size: 90%;", true));
            }
            let help = row.kind === "session" ? t.sessionHelp : row.kind === "week" ? t.weekHelp : t.otherHelp;
            block.add_actor(this._label(help, "font-size: 85%; color: rgba(160,160,160,1);", true));
            this.contentBox.add_actor(block);
        }

        this.contentBox.add_actor(this._label(fmt(t.legend, this.warn_threshold, this.crit_threshold), "font-size: 85%;", true));

        if (this.usage.detail) {
            this.contentBox.add_actor(this._label(t.local, "font-weight: bold;"));
            this.contentBox.add_actor(this._label(this.usage.detail, "font-size: 85%; color: rgba(160,160,160,1);", true));
        }

        let footer = fmt(t.updated, this.updatedAt ? this.updatedAt.format("%H:%M") : "-");
        this.contentBox.add_actor(this._label(footer, "font-size: 80%; color: rgba(160,160,160,1);"));
        if (this.errorText) {
            this.contentBox.add_actor(this._label(t.error + ": " + this.errorText, "font-size: 85%; color: " + this.color_crit + ";", true));
        }
    }

    _loadState() {
        try {
            let [ok, bytes] = GLib.file_get_contents(STATE_FILE);
            return ok ? JSON.parse(String.fromCharCode.apply(null, bytes)) : {};
        } catch (e) {
            return {};
        }
    }

    _saveState() {
        try {
            GLib.mkdir_with_parents(STATE_DIR, 0o755);
            GLib.file_set_contents(STATE_FILE, JSON.stringify(this.notifyState));
        } catch (e) {
            global.logError(UUID + ": cannot save state: " + e);
        }
    }

    _checkNotifications(rows) {
        if (!this.notify_enabled) {
            return;
        }
        let t = this.t;
        for (let row of rows) {
            let thresholds = row.kind === "session" ? parseThresholds(this.session_thresholds)
                : row.kind === "week" ? parseThresholds(this.week_thresholds) : [];
            let key = row.kind === "other" ? row.name : row.kind;
            let entry = this.notifyState[key];
            if (!entry || entry.resets !== row.resets) {
                entry = { resets: row.resets, notified: [] };
            }
            for (let th of thresholds) {
                if (row.pct >= th && entry.notified.indexOf(th) < 0) {
                    let title = row.kind === "session" ? fmt(t.notifySession, th)
                        : fmt(t.notifyWeek, th);
                    this._notify(title, fmt(t.notifyBody, row.pct, row.resets || "-"), th >= this.crit_threshold ? "critical" : "normal");
                    entry.notified.push(th);
                }
            }
            this.notifyState[key] = entry;
        }
        this._saveState();
    }

    _notify(title, body, urgency) {
        Util.spawn(["notify-send", "-u", urgency, "-a", "Claude usage", title, body]);
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new ClaudeUsageApplet(orientation, panelHeight, instanceId);
}
