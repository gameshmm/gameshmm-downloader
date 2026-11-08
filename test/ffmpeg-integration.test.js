'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffmpegPath = require('ffmpeg-static');

function probeWithFfmpeg(filePath) {
  try {
    execFileSync(ffmpegPath, ['-hide_banner', '-i', filePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return '';
  } catch (err) {
    return (err.stderr || err.stdout || '').toString();
  }
}

describe('ffmpeg-static media pipeline integration', () => {
  let tmpDir;
  let sampleVideo;
  let sampleCover;

  before(() => {
    assert.ok(ffmpegPath && fs.existsSync(ffmpegPath), 'ffmpeg-static binary must exist');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdl-ffmpeg-test-'));
    sampleVideo = path.join(tmpDir, 'sample.mkv');
    sampleCover = path.join(tmpDir, 'cover.png');

    execFileSync(ffmpegPath, [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k',
      sampleVideo,
    ]);

    execFileSync(ffmpegPath, [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x7c5cff:size=128x128:d=1',
      '-frames:v', '1',
      sampleCover,
    ]);
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('transcodes trimmed H.264/AAC MP4 preserving faststart and expected duration', () => {
    const outMp4 = path.join(tmpDir, 'trimmed.mp4');
    execFileSync(ffmpegPath, [
      '-y', '-v', 'error',
      '-ss', '0.5', '-to', '1.5',
      '-i', sampleVideo,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outMp4,
    ]);
    assert.ok(fs.statSync(outMp4).size > 1024);
    const info = probeWithFfmpeg(outMp4);
    assert.match(info, /Video:\s*h264/i);
    assert.match(info, /Audio:\s*aac/i);
    assert.match(info, /Duration:\s*00:00:01/);
  });

  it('converts to MP3 with embedded attached_pic cover art stream', () => {
    const outMp3 = path.join(tmpDir, 'audio_with_cover.mp3');
    execFileSync(ffmpegPath, [
      '-y', '-v', 'error',
      '-i', sampleVideo,
      '-i', sampleCover,
      '-map', '0:a', '-map', '1:v',
      '-c:a', 'libmp3lame', '-b:a', '192k',
      '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic',
      '-id3v2_version', '3',
      outMp3,
    ]);
    assert.ok(fs.statSync(outMp3).size > 1024);
    const info = probeWithFfmpeg(outMp3);
    assert.match(info, /Audio:\s*mp3/i);
    assert.match(info, /attached pic/i);
  });
});
