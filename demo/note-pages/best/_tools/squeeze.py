# squeeze.py in.mp4 out.mp4 [hold] [speed]: shortens still stretches (the test runner waiting) to `hold` s, then speeds up.
import subprocess, sys, re
src, dst = sys.argv[1], sys.argv[2]
hold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.9
speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
log = subprocess.run(["ffmpeg", "-i", src, "-vf", "freezedetect=n=0.0008:d=0.5", "-map", "0:v", "-f", "null", "-"], capture_output=True, text=True).stderr
starts = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", log)]; ends = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", log)]
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], capture_output=True, text=True).stdout)
while len(ends) < len(starts): ends.append(dur)
cuts = [(a + (hold if b < dur - .05 else 1.6), b) for a, b in zip(starts, ends) if b - a > hold + .1]
expr = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in cuts) or "0"
subprocess.run(["nice", "-n", "10", "ffmpeg", "-loglevel", "error", "-y", "-i", src, "-vf", f"fps=30,select='not({expr})',setpts=N/30/TB/{speed},fps=30", "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-an", dst], check=True)
