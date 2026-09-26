# Claude Usage Alert

A panel applet for Linux Mint **Cinnamon** that shows your real Claude Code plan usage
(session and weekly %), colour-coded, with explanations in a popup and desktop
notifications when you cross thresholds you choose.

The numbers come from Claude Code's own `/usage` command (`claude -p /usage`), so they
match what Claude Code shows. No OAuth token is read, no private API is called, no
tokens are spent.

## Features

- Panel text like `S 11%  W 67%`, coloured green / yellow / red.
- Click for a popup: bars, reset times, what each limit means, and Claude Code's
  breakdown for this machine.
- Notifications at configurable thresholds (default 70% and 90%) for session and week;
  each threshold fires once per limit window.
- Graphical settings (right-click -> Configure): refresh interval, colours and levels,
  thresholds, panel format, English / Russian UI.

## Compatibility

- The **applet** targets the Cinnamon panel API, so it runs on any distribution with
  Cinnamon (developed and tested on Linux Mint, Cinnamon 6.4.8). It does not run on
  GNOME, KDE, XFCE or MATE.
- The **`cli/` script** needs only Python 3, systemd and `notify-send`, so it works on any
  Linux desktop (notifications only, no panel indicator).
- The parser expects the English output of `claude -p /usage`.

## Install

    ./install.sh

Then add "Claude Usage Alert" to the panel (right-click the panel -> Applets).
Requires Claude Code (`claude`) installed and logged in, and `notify-send`.

## Headless alternative

`cli/` contains a small Python script and systemd user units that do the same
notifications without a desktop applet. Do not run it together with the applet, or
you will get every notification twice.

    install -Dm755 cli/claude-usage-alert ~/.local/bin/claude-usage-alert
    install -Dm644 cli/config.env.example ~/.config/claude-usage-alert/config.env
    install -Dm644 cli/systemd/claude-usage-alert.{service,timer} -t ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now claude-usage-alert.timer

## Prior art

This is not the first tool of its kind. Related projects:

- [claude-usage@mtwebster](https://github.com/linuxmint/cinnamon-spices-applets/tree/master/claude-usage@mtwebster)
  - Cinnamon applet (no notifications) that polls `api.anthropic.com/api/oauth/usage`.
- [claude-code-limit-alerts](https://github.com/aquahitt/claude-code-limit-alerts) - macOS alerts.
- [plasma-applet-claudemeter](https://github.com/p3kj/plasma-applet-claudemeter),
  [gnome-shell-extension-claude-usage](https://github.com/stfnRO/gnome-shell-extension-claude-usage) - KDE / GNOME.

This project differs by reading `claude -p /usage` instead of the OAuth endpoint.
The output format of `/usage` is not a stable API; if it changes, the parser in
`applet.js` (`ROW_RE`) needs an update.

## Contact

Questions and bug reports: open an issue, or write to apk.workpost@yandex.ru.

## License

MIT, see [LICENSE](LICENSE).
