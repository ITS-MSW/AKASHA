# Akasha Capture

The WXT Manifest V3 extension for capturing images and downloadable videos into Akasha. It uses an in-page capture panel and the `Save to Akasha` media context-menu action. Ordinary X videos also expose a small Save button on hover.

X video capture matches the selected post and poster to direct MP4 variants. It saves the highest-bitrate variant that fits 50 MiB. Direct MP4/WebM sources on other sites are supported; HLS-only and protected sources are not. Reload existing X tabs after updating the extension so the observer can see their post responses.

Video jobs use the same persistent delivery queue and retry controls as images. New successful saves contain private Drive bytes, not a source link.

See the [workspace README](../README.md) for OAuth setup and commands.
