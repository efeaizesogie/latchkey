// Compose the demo: per scene, background frame + app recording inside the phone + bezel + voice-over,
// then concat with a quiet generated music bed. Output: out/latchkey-demo.mp4 (1920x1080, 30 fps).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const dur = (f) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const scenes = JSON.parse(readFileSync('out/timing.json', 'utf8'));
mkdirSync('out/clips', { recursive: true });

const SCREEN = { x: 1211, y: 77, w: 428, h: 926 };
const STATUS = 46; // status bar drawn in the bezel; the app sits below it
const LEAD = 0.5; // voice starts after the cut
const FADE = 0.35;
const shotDirs = readdirSync('out/shots');

const clips = [];
for (const s of scenes) {
  const out = `out/clips/${s.id}.mp4`;
  let D = s.vo_s + LEAD + 1.0;
  if (s.kind === 'app') {
    // 1. the screen recording(s) for this scene, at 30 fps and phone-screen size
    const parts = shotDirs.filter((d) => d.startsWith(s.id + '-')).sort();
    const partFiles = parts.map((d) => {
      const f = `out/clips/${d}.mp4`;
      ff(['-f', 'concat', '-safe', '0', '-i', `out/shots/${d}/list.txt`, '-vf', `fps=30,scale=${SCREEN.w}:${SCREEN.h}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', f]);
      return f;
    });
    const screenRaw = `out/clips/${s.id}-screen.mp4`;
    writeFileSync(`out/clips/${s.id}-parts.txt`, partFiles.map((f) => `file '${f.replace('out/clips/', '')}'`).join('\n'));
    ff(['-f', 'concat', '-safe', '0', '-i', `out/clips/${s.id}-parts.txt`, '-c', 'copy', screenRaw]);
    const shotLen = dur(screenRaw);
    // footage longer than its narration plays a little faster (UI reads fine up to ~1.8x); voice is untouched
    const T = s.vo_s + LEAD + 1.4;
    const speed = shotLen > T ? Math.min(shotLen / T, 1.8) : 1;
    D = Math.max(D, shotLen / speed + 0.3);
    console.log(`  ${s.id}: footage ${shotLen.toFixed(1)} s at ${speed.toFixed(2)}x`);
    // 2. composite: bg -> screen -> bezel, padded to D with the last frame held
    ff([
      '-loop', '1', '-t', D.toFixed(2), '-i', `out/frames/${s.id}.png`,
      '-i', screenRaw,
      '-loop', '1', '-t', D.toFixed(2), '-i', 'out/frames/bezel.png',
      '-i', `out/vo/${s.id}.mp3`,
      '-filter_complex',
      `[1:v]setpts=PTS/${speed.toFixed(4)},fps=30,tpad=stop_mode=clone:stop_duration=${(D + 1).toFixed(2)},trim=duration=${D.toFixed(2)},setpts=PTS-STARTPTS[scr];` +
        `[scr]crop=${SCREEN.w}:${SCREEN.h - STATUS}:0:0[scr2];[0:v][scr2]overlay=${SCREEN.x}:${SCREEN.y + STATUS}[a];[a][2:v]overlay=0:0,format=yuv420p,` +
        `fade=t=in:st=0:d=${FADE},fade=t=out:st=${(D - FADE).toFixed(2)}:d=${FADE}[v];` +
        `[3:a]adelay=${LEAD * 1000}|${LEAD * 1000},apad,atrim=duration=${D.toFixed(2)}[au]`,
      '-map', '[v]', '-map', '[au]', '-r', '30', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', out,
    ]);
  } else {
    // title card: slow push-in on the still
    const frames = Math.round(D * 30);
    ff([
      '-loop', '1', '-i', `out/frames/${s.id}.png`, '-i', `out/vo/${s.id}.mp3`,
      '-filter_complex',
      `[0:v]scale=2304:1296,zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30,format=yuv420p,` +
        `fade=t=in:st=0:d=${FADE * 2},fade=t=out:st=${(D - FADE * 2).toFixed(2)}:d=${FADE * 2}[v];` +
        `[1:a]adelay=${LEAD * 1000}|${LEAD * 1000},apad,atrim=duration=${D.toFixed(2)}[au]`,
      '-map', '[v]', '-map', '[au]', '-t', D.toFixed(2), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', out,
    ]);
  }
  clips.push({ id: s.id, file: out, D: dur(out) });
  console.log(`${s.id}: ${dur(out).toFixed(1)} s`);
}

// concat scenes
writeFileSync('out/clips/all.txt', clips.map((c) => `file '${c.file.replace('out/clips/', '')}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', 'out/clips/all.txt', '-c', 'copy', 'out/body.mp4']);
const total = dur('out/body.mp4');

// a quiet, warm music bed: two detuned pads (A minor 9 -> F major 7) with slow swell, low-passed
const bed = 'out/bed.wav';
if (!existsSync(bed) || true) {
  const chord = (f, t0, len) =>
    `sin(2*PI*${f}*t)*0.10+sin(2*PI*${f * 1.5}*t)*0.06+sin(2*PI*${f * 2.0}*t)*0.05+sin(2*PI*${f * 1.2}*t)*0.05`;
  ff([
    '-f', 'lavfi', '-i', `aevalsrc='(${chord(110, 0, 8)})*(0.6+0.4*sin(2*PI*t/9))':s=48000:d=${total.toFixed(2)}`,
    '-f', 'lavfi', '-i', `aevalsrc='(${chord(87.31, 0, 8)})*(0.6+0.4*sin(2*PI*t/11+1))':s=48000:d=${total.toFixed(2)}`,
    '-filter_complex', `[0:a][1:a]amix=inputs=2:duration=longest,lowpass=f=900,aecho=0.8:0.7:120|240:0.25|0.15,volume=0.22,afade=t=in:d=3,afade=t=out:st=${(total - 4).toFixed(2)}:d=4[a]`,
    '-map', '[a]', '-ac', '2', bed,
  ]);
}
ff([
  '-i', 'out/body.mp4', '-i', bed,
  '-filter_complex', '[1:a]volume=1.6[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11[a]',
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', 'out/latchkey-demo.mp4',
]);
console.log(`demo: out/latchkey-demo.mp4, ${dur('out/latchkey-demo.mp4').toFixed(1)} s`);
