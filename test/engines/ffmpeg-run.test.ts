// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { parseDurationSeconds, runFfmpeg } from '@/lib/engines/ffmpeg-run'

import { type FakeFfmpeg, fakeFfmpeg, realFfmpeg } from './ffmpeg-core'

const running = () => new AbortController().signal
const quiet = () => {}

const source = new Uint8Array([9, 9, 9, 9])

const run = (core: FakeFfmpeg, over: Record<string, unknown> = {}, signal = running()) =>
  runFfmpeg({
    core,
    bytes: source,
    job: { from: 'mp4', to: 'mp4', keepVideo: true, ...over } as never,
    signal,
    onProgress: quiet,
  })

describe('runFfmpeg', () => {
  it('writes the input, runs the command, and reads the output back', async () => {
    const core = fakeFfmpeg()
    core.output = new Uint8Array([7, 7, 7])

    const result = await run(core)

    expect(core.execs).toHaveLength(1)
    expect(core.execs[0].files).toEqual(['/input.mp4'])
    expect(result.bytes).toEqual(new Uint8Array([7, 7, 7]))
    expect(result.mimeType).toBe('video/mp4')
  })

  it('names both files by their format, which is how ffmpeg picks a muxer', async () => {
    const core = fakeFfmpeg()

    await run(core, { from: 'mkv', to: 'mp3', keepVideo: false })

    // An extensionless output makes ffmpeg refuse the job outright with
    // "Unable to find a suitable output format".
    expect(core.execs[0].args).toContain('/input.mkv')
    expect(core.execs[0].args.at(-1)).toBe('/output.mp3')
  })

  it('leaves the filesystem empty when the job succeeds', async () => {
    // MEMFS lives in the WASM heap and the core is kept warm between jobs, so a
    // file left behind is a whole video resident for the rest of the session.
    const core = fakeFfmpeg()

    await run(core)

    expect([...core.files.keys()]).toEqual([])
  })

  it('leaves it empty when the job fails', async () => {
    const core = fakeFfmpeg()
    core.status = 1

    await expect(run(core)).rejects.toThrow(/could not be converted to MP4/)
    expect([...core.files.keys()]).toEqual([])
  })

  it('leaves it empty when the job is cancelled part way through', async () => {
    const core = fakeFfmpeg()
    const controller = new AbortController()
    core.duringExec = () => controller.abort()

    await expect(run(core, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect([...core.files.keys()]).toEqual([])
  })

  it('quotes what ffmpeg said last when it fails', async () => {
    const core = fakeFfmpeg()
    core.status = 1
    core.duringExec = (fake) => {
      fake.logger({ type: 'stderr', message: 'ffmpeg version 5.1.4' })
      fake.logger({ type: 'stderr', message: 'Invalid data found when processing input' })
    }

    await expect(run(core)).rejects.toThrow(/Invalid data found/)
  })

  it('stops a running job by setting a deadline that has already passed', async () => {
    // `exec` is one synchronous call into WebAssembly, so the worker's message
    // loop cannot deliver an abort while it runs. ffmpeg checks a deadline from
    // inside its own encoding loop, which is the only way in.
    const core = fakeFfmpeg()
    const controller = new AbortController()
    core.duringExec = (fake) => {
      controller.abort()
      expect(fake.deadline).toBeGreaterThan(0)
      expect(fake.deadline).toBeLessThan(1)
    }

    await expect(run(core, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('clears the deadline afterwards, so a cancel cannot outlive its job', async () => {
    const core = fakeFfmpeg()
    const controller = new AbortController()
    core.duringExec = () => controller.abort()

    await expect(run(core, {}, controller.signal)).rejects.toThrow()

    expect(core.deadline).toBe(-1)
    // The next job starts clean, not stopped by the last one's cancel.
    const next = fakeFfmpeg()
    await expect(run(next)).resolves.toBeDefined()
  })

  it('reports a cancel as a cancel, not as a broken file', async () => {
    // A cancelled run exits non-zero, and reporting that as a conversion failure
    // would tell the user their file was damaged when it was not.
    const core = fakeFfmpeg()
    core.status = 1
    const controller = new AbortController()
    core.duringExec = () => controller.abort()

    await expect(run(core, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses a job that was cancelled before it started, without writing anything', async () => {
    const core = fakeFfmpeg()
    const controller = new AbortController()
    controller.abort()

    await expect(run(core, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(core.execs).toEqual([])
    expect([...core.files.keys()]).toEqual([])
  })

  it('passes ffmpeg’s own progress through, and says so when it does not know', async () => {
    const core = fakeFfmpeg()
    const seen: number[] = []
    core.duringExec = (fake) => {
      fake.progress({ progress: 0.5, time: 0 })
      // A negative fraction is what ffmpeg reports for an input whose duration
      // it could not read, and -1 is what that means here.
      fake.progress({ progress: -3, time: 0 })
      fake.progress({ progress: 1.4, time: 0 })
    }

    await runFfmpeg({
      core,
      bytes: source,
      job: { from: 'mp4', to: 'mp4', keepVideo: true } as never,
      signal: running(),
      onProgress: (value) => seen.push(value),
    })

    expect(seen).toEqual([0.5, -1, 1, 1])
  })
})

describe('runFfmpeg against the real core', () => {
  // Loading 31 MB of WebAssembly, twice: generous, and still under a second in
  // practice. The point is the two claims a fake cannot make — that the
  // arguments this project builds are arguments ffmpeg accepts, and that they
  // produce a file.
  it('converts a real video and leaves nothing in the filesystem', async () => {
    const core = await realFfmpeg()

    // A source made by ffmpeg itself: the repository holds no video fixture,
    // and one generated from a synthetic pattern is a real H.264 MP4.
    core.reset()
    const made = core.exec(
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=160x120:rate=15',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '/source.mp4',
    )
    expect(made).toBe(0)
    const bytes = core.FS.readFile('/source.mp4')
    const input = new Uint8Array(bytes.length)
    input.set(bytes)
    core.FS.unlink('/source.mp4')

    const result = await runFfmpeg({
      core,
      bytes: input,
      job: { from: 'mp4', to: 'mp4', keepVideo: true, video: { width: 80 } } as never,
      signal: running(),
      onProgress: quiet,
    })

    expect(result.bytes.length).toBeGreaterThan(0)
    expect(result.mimeType).toBe('video/mp4')
    // `ftyp` at offset 4: what ffmpeg wrote really is an ISO container.
    expect(String.fromCharCode(...result.bytes.subarray(4, 8))).toBe('ftyp')
    expect(core.FS.readdir('/')).not.toContain('input.mp4')
    expect(core.FS.readdir('/')).not.toContain('output.mp4')
  }, 60_000)

  it('pulls the sound out of a video into an MP3', async () => {
    const core = await realFfmpeg()

    core.reset()
    expect(
      core.exec(
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=160x120:rate=15',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-c:a',
        'aac',
        '/withsound.mp4',
      ),
    ).toBe(0)
    const bytes = core.FS.readFile('/withsound.mp4')
    const input = new Uint8Array(bytes.length)
    input.set(bytes)
    core.FS.unlink('/withsound.mp4')

    const result = await runFfmpeg({
      core,
      bytes: input,
      job: { from: 'mp4', to: 'mp3', keepVideo: false } as never,
      signal: running(),
      onProgress: quiet,
    })

    expect(result.mimeType).toBe('audio/mpeg')
    // An MP3 frame header, or an ID3 tag in front of one.
    const header = result.bytes.subarray(0, 3)
    const isMp3 = header[0] === 0xff || String.fromCharCode(...header) === 'ID3'
    expect(isMp3).toBe(true)
  }, 60_000)
})

describe('the duration probe', () => {
  const DURATION_LINE = '  Duration: 00:01:30.50, start: 0.000000, bitrate: 1201 kb/s'

  it('reads the running time out of the line ffmpeg prints about its input', () => {
    expect(parseDurationSeconds([DURATION_LINE])).toBeCloseTo(90.5, 5)
  })

  it('handles a file long enough to need three hour digits', () => {
    expect(parseDurationSeconds(['Duration: 100:00:00.00'])).toBe(360_000)
  })

  it('answers null for a container that does not carry one', () => {
    expect(parseDurationSeconds(['  Duration: N/A, start: 0.000000, bitrate: N/A'])).toBeNull()
    expect(parseDurationSeconds([])).toBeNull()
  })

  it('asks ffmpeg only when the job actually needs the answer', async () => {
    const core = fakeFfmpeg()

    await runFfmpeg({
      core,
      bytes: new Uint8Array([1, 2, 3]),
      job: {
        from: 'mp4',
        to: 'mp4',
        keepVideo: true,
        video: { compression: { method: 'quality', crf: 20 } },
      },
      signal: new AbortController().signal,
      onProgress: () => {},
    })

    // One exec: the conversion. A probe is a whole WASM call, and three of the
    // four sizing methods have nothing to ask it.
    expect(core.execs).toHaveLength(1)
  })

  it('probes before the conversion and feeds the answer into the command line', async () => {
    const core = fakeFfmpeg()
    core.duringExec = (fake) => {
      fake.logger({ type: 'stderr', message: DURATION_LINE })
    }

    await runFfmpeg({
      core,
      bytes: new Uint8Array([1, 2, 3]),
      job: {
        from: 'mp4',
        to: 'mp4',
        keepVideo: true,
        video: { compression: { method: 'target-size', targetBytes: 8 * 1024 * 1024 } },
      },
      signal: new AbortController().signal,
      onProgress: () => {},
    })

    expect(core.execs).toHaveLength(2)
    expect(core.execs[0].args).toEqual(['-hide_banner', '-i', '/input.mp4'])
    // 90.5 seconds of it, so the rate is a real number rather than a default.
    const bitrate = core.execs[1].args[core.execs[1].args.indexOf('-b:v') + 1]
    expect(Number(bitrate)).toBeGreaterThan(0)
  })

  it('leaves nothing behind when the probe ran', async () => {
    const core = fakeFfmpeg()
    core.duringExec = (fake) => {
      fake.logger({ type: 'stderr', message: DURATION_LINE })
    }

    await runFfmpeg({
      core,
      bytes: new Uint8Array([1, 2, 3]),
      job: {
        from: 'mp4',
        to: 'mp4',
        keepVideo: true,
        video: { compression: { method: 'target-size', targetBytes: 8 * 1024 * 1024 } },
      },
      signal: new AbortController().signal,
      onProgress: () => {},
    })

    expect([...core.files.keys()]).toEqual([])
  })
})

describe('GIF against the real core', () => {
  /**
   * The claim a fake cannot make: that the vendored build has `palettegen`,
   * `paletteuse` and the GIF encoder compiled in at all, and that the filter
   * chain this project writes is one ffmpeg accepts. A chain it rejects fails
   * only at run time, after a 31 MB download, on the user's machine.
   */
  it('turns a real video into a real GIF with a generated palette', async () => {
    const core = await realFfmpeg()

    core.reset()
    const made = core.exec(
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=160x120:rate=15',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '/source.mp4',
    )
    expect(made).toBe(0)
    const bytes = core.FS.readFile('/source.mp4')
    const input = new Uint8Array(bytes.length)
    input.set(bytes)
    core.FS.unlink('/source.mp4')

    const result = await runFfmpeg({
      core,
      bytes: input,
      job: {
        from: 'mp4',
        to: 'gif',
        keepVideo: true,
        video: { width: 80, frameRate: 8 },
      } as never,
      signal: running(),
      onProgress: quiet,
    })

    expect(result.mimeType).toBe('image/gif')
    // `GIF89a`, which is the only header a file with a palette and an animation
    // can carry.
    expect(String.fromCharCode(...result.bytes.subarray(0, 6))).toBe('GIF89a')
    expect(core.FS.readdir('/')).not.toContain('output.gif')
  }, 60_000)
})
