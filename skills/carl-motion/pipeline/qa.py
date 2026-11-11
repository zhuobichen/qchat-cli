"""单支B的规格与画面检查。用法: python3 -I qa.py S06 <B.mp4> <A参考.mp4> <QA输出目录>"""
import json, subprocess, sys, os
import numpy as np

sid, b_path, a_path, out_root = sys.argv[1:5]
out = os.path.join(out_root, sid)
os.makedirs(out, exist_ok=True)


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def probe(p):
    r = run(["ffprobe", "-v", "error", "-count_frames", "-show_entries",
             "stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,duration:format=duration",
             "-of", "json", p])
    return json.loads(r.stdout)


def frames_gray(p, w=192, h=108):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
                       capture_output=True)
    a = np.frombuffer(r.stdout, np.uint8)
    return a.reshape(-1, h, w).astype(np.float32)


res = {"id": sid, "file": os.path.basename(b_path)}
pb = probe(b_path)
streams = pb["streams"]
v = [s for s in streams if s["codec_type"] == "video"][0]
res["spec"] = {
    "width": v["width"], "height": v["height"], "codec": v["codec_name"], "profile": v.get("profile"),
    "pix_fmt": v["pix_fmt"], "r_frame_rate": v["r_frame_rate"], "frames": int(v["nb_read_frames"]),
    "duration": float(pb["format"]["duration"]),
    "audio_streams": len([s for s in streams if s["codec_type"] == "audio"]),
}
s = res["spec"]
res["spec_pass"] = (s["width"] == 1920 and s["height"] == 1080 and s["codec"] == "h264" and s["pix_fmt"] == "yuv420p"
                    and s["r_frame_rate"] == "30/1" and s["frames"] == 240 and abs(s["duration"] - 8.0) < 1e-3
                    and s["audio_streams"] == 0)

dec = run(["ffmpeg", "-v", "error", "-xerror", "-i", b_path, "-f", "null", "-"])
res["full_decode_errors"] = dec.stderr.strip()
res["full_decode_pass"] = dec.returncode == 0 and not dec.stderr.strip()

g = frames_gray(b_path)
diff = np.abs(np.diff(g, axis=0)).mean(axis=(1, 2))
res["motion"] = {
    "frames_decoded": int(g.shape[0]),
    "mean_absdiff": round(float(diff.mean()), 3),
    "min_absdiff": round(float(diff.min()), 4),
    "max_absdiff": round(float(diff.max()), 3),
    "near_static_pairs(<0.02)": int((diff < 0.02).sum()),
    "longest_static_run_frames": 0,
    "jump_frames(>6x_median_and>8)": [int(i + 1) for i in np.where((diff > 6 * np.median(diff)) & (diff > 8))[0]],
    "black_frames(mean<6)": int((g.mean(axis=(1, 2)) < 6).sum()),
}
run_len = best = 0
for d in diff:
    run_len = run_len + 1 if d < 0.02 else 0
    best = max(best, run_len)
res["motion"]["longest_static_run_frames"] = best
res["motion_pass"] = best < 15 and res["motion"]["black_frames(mean<6)"] == 0
np.savetxt(os.path.join(out, "frame_absdiff.txt"), diff, fmt="%.4f")

ga = frames_gray(a_path)
da = np.abs(np.diff(ga, axis=0)).mean(axis=(1, 2))
res["A_motion_mean_absdiff"] = round(float(da.mean()), 3)

times = [0.5, 2, 4, 6, 7.5]
for t in times:
    run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", b_path, "-frames:v", "1", os.path.join(out, f"B_{t}s.jpg")])
# A/B 上下同步对比条：上A下B，5个时间点
fc = []
inputs = []
for i, t in enumerate(times):
    inputs += ["-ss", str(t), "-i", a_path, "-ss", str(t), "-i", b_path]
for i in range(len(times)):
    fc.append(f"[{2*i}:v]scale=640:360,setsar=1[a{i}];[{2*i+1}:v]scale=640:360,setsar=1[b{i}];[a{i}][b{i}]vstack[c{i}]")
fc.append("".join(f"[c{i}]" for i in range(len(times))) + f"hstack=inputs={len(times)}[o]")
run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[o]", "-frames:v", "1",
     os.path.join(out, "AB_compare_0.5_2_4_6_7.5.jpg")])
# 9:16 三分屏缩放可读性预览（上A 中B 下留空口播位）
run(["ffmpeg", "-v", "error", "-y", "-ss", "4", "-i", a_path, "-ss", "4", "-i", b_path, "-filter_complex",
     "[0:v]scale=1080:608,setsar=1[a];[1:v]scale=1080:608,setsar=1[b];color=c=0x222222:s=1080x704[c];[a][b][c]vstack=inputs=3[o]",
     "-map", "[o]", "-frames:v", "1", os.path.join(out, "vertical_preview_4s.jpg")])
# 连续审看用：B 全片 2fps 缩略条
run(["ffmpeg", "-v", "error", "-y", "-i", b_path, "-vf", "fps=2,scale=384:-1,tile=8x2", "-frames:v", "1",
     os.path.join(out, "B_contact_2fps.jpg")])

res["pass_auto"] = res["spec_pass"] and res["full_decode_pass"] and res["motion_pass"]
json.dump(res, open(os.path.join(out, "qa.json"), "w"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
