# Pipeline · 流水线

The tools behind the 29-style video. They read and write a *delivery root*, a folder laid out like this (the folder names are Chinese because the project was run in Chinese):

| Folder | Holds |
|---|---|
| `完成片/` | finished B clips, `<ID>_B_8s.mp4` |
| `色序/` | colour-order data and cut checks |
| `脚本/` | script, prompt table and the 9:16 video |
| `QA/` | qa.py reports |

Style text lives in `script_data.py`; the playback order comes from `data/color-order-v4.json` in this repo.

| Script | What it does | Run |
|---|---|---|
| `encode.sh` | 240 PNG frames → H.264 1920×1080 30 fps, CRF 16, yuv420p, no audio | `bash encode.sh <frames> <out.mp4>` |
| `qa.py` | format, frame count, black frames, jump cuts, motion stats against the A clip | `python3 qa.py <ID> <B.mp4> <A.mp4> <out_dir>` |
| `color_clips.py` | cuts the 8-second windows used everywhere else | `python3 color_clips.py <root> <pkg> <out_dir> [W H]` |
| `color_order_v4.py` | measures dominant hue in CIELAB and orders styles so neighbours are near-complementary | `python3 color_order_v4.py <root> <clips> <opener ID>` |
| `color_stitch_verify.py` | re-measures every cut on the stitched video, rates good / fair / weak | `python3 color_stitch_verify.py <root> <clips> v4` |
| `opener_salience.py` | scores each style as an opener on CIELAB salience over the first 10 s | `python3 opener_salience.py <root> <clips>` |
| `script_md.py` | writes the spoken script in Markdown | `python3 script_md.py <root>` |
| `prompt_table.py` | writes the prompt comparison table (.md and .xlsx with thumbnails) | `python3 prompt_table.py <root> <clips>` |
| `script_layout.py` | renders the 9:16 explainer video, four beats per style | `python3 script_layout.py <root> <1080×608 clips> <tmp> [opener ID]` |

Dependencies: Python 3.9+, numpy, opencv-python, Pillow, openpyxl (table only), ffmpeg. `script_layout.py` uses the macOS font Hiragino Sans GB; change `FONT` on other systems.

本目录是做那支 29 画风盘点视频的工具链，脚本读写的交付目录结构见上表，各脚本用法同上。
