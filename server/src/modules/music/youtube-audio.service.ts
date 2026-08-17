import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';

export interface ResolvedAudio {
  stream: Readable;
  mimeType: string;
  durationSeconds: number | null;
  estimatedBytes: number | null;
  // Resolves once the yt-dlp process exits. A failed download still ends
  // its stdout "cleanly" (the pipe just closes with 0 bytes) — Node
  // fires that 'end' *before* the process 'close' event, so anything
  // piping from `stream` sees a normal finish before we'd ever get a
  // chance to signal the error on the stream itself. Callers must await
  // this and check for a non-zero code before trusting a finished pipe
  // as a real success.
  exitCode: Promise<number | null>;
}

const MIME_BY_EXT: Record<string, string> = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
};

// Cloud-provider IP ranges (AWS/GCP/etc.) routinely get YouTube's "Sign in
// to confirm you're not a bot" anti-bot block. Cookies from an
// authenticated browser session work around it. The cookies file is
// expected to be bind-mounted into the container at this path (see
// docker-compose.yml) rather than passed as an env var — a real cookies
// file is easily large enough to blow past the OS's combined
// argument+environment size limit (exec fails with "argument list too
// long"), so a file mount is the only robust option here.
const COOKIES_PATH = join(process.cwd(), 'yt-dlp-cookies.txt');

// YouTube protects real stream URLs behind an obfuscated-JS signature/"n
// challenge" that yt-dlp must execute to decipher. Having a JS runtime
// (deno, installed in the image) isn't enough on its own — yt-dlp also
// needs the actual solver script, and won't auto-download that without
// this flag (by design, since it means fetching and running remote code).
// Confirmed via direct testing: without this, every video silently falls
// back to storyboard-only "formats" with no visible error.
const REMOTE_COMPONENTS_ARGS = ['--remote-components', 'ejs:github'];

// yt-dlp's own client cascade will happily fall back to the `android_vr`
// player client when other clients don't expose a matching format for a
// given video. android_vr-sourced stream URLs are fundamentally
// incompatible with cookie-based auth (confirmed live: yt-dlp selects it,
// downloads the m3u8/format info fine, then the actual data request
// 403s) — cookies only help against the bot-check on clients that accept
// them at all. Excluding it forces yt-dlp onto a client where our cookies
// actually apply, even if that means fewer format choices for some videos.
const EXTRACTOR_ARGS = [
  '--extractor-args',
  'youtube:player_client=default,-android_vr',
];

// Cap quality instead of always grabbing the highest-bitrate audio-only
// stream (~130kbps opus/m4a on most videos) — this is background music,
// not something anyone's critically listening to, and every listener
// fetches the full file fresh (no partial/streaming benefit, since it's
// pulled via fetch() -> blob: for the CSP fix). ~96kbps is still solid for
// this use case at roughly half the bandwidth/storage per song.
//
// Some extraction attempts offer no audio-only stream at all (YouTube's
// own per-request volatility, not something we control) — in that case
// prefer the smallest available *non-HLS* stream over the largest. HLS
// (m3u8) formats are fetched as dozens of separate fragment requests
// instead of one file, which is meaningfully less reliable, and without
// the protocol exclusion here `best` would happily pick a huge 1080p HLS
// stream over a small plain-https one for no benefit to us.
const FORMAT_SELECTOR =
  'bestaudio[abr<=96][protocol!*=m3u8]/bestaudio[protocol!*=m3u8]/worst[protocol!*=m3u8]/best';

// YouTube's own extraction behavior varies request-to-request for the
// same video (different internal player client picked each time, with
// different PO-token/SABR handling) — a request that fails with "Sign in
// to confirm you're not a bot" often just succeeds on the next attempt.
// Retrying the (cheap, --skip-download) probe step catches this before
// ever starting a real download.
const MAX_PROBE_ATTEMPTS = 3;

// The same per-request volatility can *also* hit the actual download
// step even after probe succeeded (confirmed live: probe resolves a
// format fine, then the separate download invocation 403s). Retried the
// same way, gated on whether any real data ever started flowing — see
// attemptDownload().
const MAX_DOWNLOAD_ATTEMPTS = 3;

// youtubei.js (pure npm) can no longer fetch playable stream URLs for most
// videos without solving YouTube's PO-token anti-bot challenge, which in
// practice requires a headless browser. yt-dlp ships its own actively
// maintained PO-token handling, so we shell out to it instead — see
// server/Dockerfile for the binary install.
@Injectable()
export class YoutubeAudioService implements OnModuleInit {
  private readonly logger = new Logger(YoutubeAudioService.name);

  onModuleInit() {
    this.logger.log(
      existsSync(COOKIES_PATH)
        ? `yt-dlp cookies file found at ${COOKIES_PATH}`
        : "no yt-dlp cookies file mounted — requests may hit YouTube's bot check",
    );
  }

  private cookieArgs(): string[] {
    return existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : [];
  }

  async fetchAudio(videoId: string): Promise<ResolvedAudio> {
    this.logger.log(`fetchAudio(${videoId}): starting probe`);
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const { durationSeconds, ext, estimatedBytes } = await this.probeWithRetry(
      url,
      videoId,
    );
    this.logger.log(
      `fetchAudio(${videoId}): probe succeeded (ext=${ext}, durationSeconds=${durationSeconds ?? '(unknown)'}, estimatedBytes=${estimatedBytes ?? '(unknown)'})`,
    );
    const mimeType = MIME_BY_EXT[ext] ?? 'audio/webm';

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
      this.logger.log(
        `fetchAudio(${videoId}): download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS}`,
      );
      try {
        const { stream, exitCode } = await this.attemptDownload(url, videoId);
        this.logger.log(
          `fetchAudio(${videoId}): attempt ${attempt} committed (data started flowing)`,
        );
        return { stream, mimeType, durationSeconds, estimatedBytes, exitCode };
      } catch (e) {
        lastError = e;
        this.logger.warn(
          `download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed for ${videoId} before any data arrived: ${(e as Error).message.slice(0, 200)}`,
        );
      }
    }
    this.logger.error(
      `fetchAudio(${videoId}): all ${MAX_DOWNLOAD_ATTEMPTS} download attempts failed`,
    );
    throw lastError;
  }

  // Spawns yt-dlp and waits for either real data to start flowing (commits
  // to this attempt and resolves immediately, so the caller can start
  // piping/streaming right away) or the process closing before any data
  // ever arrived (rejects, safe to retry since nothing was handed to a
  // consumer yet — uses the paused-mode 'readable' event specifically so
  // checking for data never consumes/loses the bytes a real .pipe()
  // consumer needs afterward). A failure *after* data has already
  // started flowing can't be silently retried this way; MusicCacheService
  // still catches that downstream via the returned `exitCode`.
  private attemptDownload(
    url: string,
    videoId: string,
  ): Promise<{ stream: Readable; exitCode: Promise<number | null> }> {
    this.logger.log(`attemptDownload(${videoId}): spawning yt-dlp`);
    return new Promise((resolve, reject) => {
      const child = spawn(
        'yt-dlp',
        [
          '-f',
          FORMAT_SELECTOR,
          '--no-playlist',
          '--no-warnings',
          ...REMOTE_COMPONENTS_ARGS,
          ...EXTRACTOR_ARGS,
          ...this.cookieArgs(),
          '-o',
          '-',
          url,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      if (!child.stdout) {
        reject(new Error(`yt-dlp produced no stdout stream for ${videoId}`));
        return;
      }
      const stdout = child.stdout;

      let committed = false;
      const exitCode = new Promise<number | null>((resolveCode) => {
        child.on('close', (code) => {
          if (code !== 0) {
            this.logger.error(
              `yt-dlp exited ${code} for ${videoId}: ${stderr.slice(0, 500)}`,
            );
          }
          if (!committed) {
            reject(
              new Error(
                `yt-dlp closed (code ${code}) before producing any data for ${videoId}: ${stderr.slice(0, 500)}`,
              ),
            );
            return;
          }
          resolveCode(code);
        });
      });

      stdout.once('readable', () => {
        if (committed) return;
        committed = true;
        resolve({ stream: stdout, exitCode });
      });
    });
  }

  private async probeWithRetry(
    url: string,
    videoId: string,
  ): Promise<{
    durationSeconds: number | null;
    ext: string;
    estimatedBytes: number | null;
  }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_PROBE_ATTEMPTS; attempt++) {
      this.logger.log(
        `probeWithRetry(${videoId}): attempt ${attempt}/${MAX_PROBE_ATTEMPTS}`,
      );
      try {
        return await this.probe(url);
      } catch (e) {
        lastError = e;
        this.logger.warn(
          `probe attempt ${attempt}/${MAX_PROBE_ATTEMPTS} failed for ${videoId}: ${(e as Error).message.slice(0, 200)}`,
        );
      }
    }
    void this.logAvailableFormats(url);
    throw lastError;
  }

  private probe(url: string): Promise<{
    durationSeconds: number | null;
    ext: string;
    estimatedBytes: number | null;
  }> {
    return new Promise((resolve, reject) => {
      const child = spawn('yt-dlp', [
        '-f',
        FORMAT_SELECTOR,
        '--no-playlist',
        '--skip-download',
        '--no-warnings',
        ...REMOTE_COMPONENTS_ARGS,
        ...EXTRACTOR_ARGS,
        ...this.cookieArgs(),
        '--print',
        '%(duration)s\t%(ext)s\t%(filesize,filesize_approx)s',
        url,
      ]);

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(`yt-dlp probe failed (${code}): ${stderr.slice(0, 500)}`),
          );
          return;
        }
        const [durationRaw, ext, sizeRaw] = stdout.trim().split('\t');
        const duration = Number(durationRaw);
        const size = Number(sizeRaw);
        resolve({
          durationSeconds: Number.isFinite(duration) ? duration : null,
          ext: ext || 'webm',
          estimatedBytes: Number.isFinite(size) && size > 0 ? size : null,
        });
      });
    });
  }

  // Fire-and-forget diagnostic dump for when format selection fails — logs
  // what yt-dlp actually sees (from this exact machine, with these exact
  // cookies) instead of leaving us guessing from a different environment.
  private logAvailableFormats(url: string): Promise<void> {
    return new Promise((resolveDone) => {
      const child = spawn('yt-dlp', [
        '--list-formats',
        '--no-warnings',
        ...REMOTE_COMPONENTS_ARGS,
        ...EXTRACTOR_ARGS,
        ...this.cookieArgs(),
        url,
      ]);
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.on('close', () => {
        this.logger.error(
          `Available formats for ${url}:\n${out.slice(0, 3000)}`,
        );
        resolveDone();
      });
      child.on('error', () => resolveDone());
    });
  }
}
