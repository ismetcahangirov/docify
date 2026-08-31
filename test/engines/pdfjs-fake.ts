/**
 * Stand-ins for pdf.js and for the surface it draws on.
 *
 * Two things make the real pair unusable in a unit test. pdf.js reaches for
 * `DOMMatrix` and `Path2D` while it is still evaluating, and it renders by
 * executing an operator list against a genuine 2D context — a stub context gets
 * three calls in before pdf.js destructures a matrix out of `getTransform()`.
 * And `OffscreenCanvas` only exists on a worker thread, which Node is not.
 *
 * So `lib/engines/pdfjs-runtime.ts` declares both as narrow interfaces and this
 * file satisfies them. What is left under test is everything the engine is
 * actually responsible for: which pages, at what size, encoded how, named what,
 * released when, and stopped on cancel.
 *
 * The *real* loader is still exercised — see the integration block in
 * `pdf-render.test.ts`, which opens a pdf-lib fixture with pdf.js itself and
 * checks the resolution arithmetic against real page geometry. It stops short of
 * rasterising, which is the one part that needs a browser.
 *
 * Test-support code, not shipped.
 */

import type {
  PdfDocument,
  PdfLoader,
  PdfLoadingTask,
  PdfPage,
  PdfRenderTask,
  RenderCanvas,
  RenderCanvasFactory,
  PdfViewport,
} from '@/lib/engines/pdfjs-runtime'

/** A page's size in PDF points, before any scaling. */
export interface FakePageSize {
  width: number
  height: number
}

export class FakeCanvas implements RenderCanvas {
  /** What it was asked for, kept after `release` zeroes `width`/`height`. */
  readonly requested: { width: number; height: number }
  readonly encodings: { type?: string; quality?: number }[] = []

  constructor(
    public width: number,
    public height: number,
    private readonly bytes: Uint8Array<ArrayBuffer>,
  ) {
    this.requested = { width, height }
  }

  /** True once `releaseCanvas` has zeroed both axes. */
  get released(): boolean {
    return this.width === 0 && this.height === 0
  }

  async convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob> {
    this.encodings.push({ ...options })

    return new Blob([this.bytes], { type: options?.type })
  }
}

export class FakePage implements PdfPage {
  cleanups = 0
  renders = 0
  cancels = 0
  textReads = 0

  constructor(
    private readonly fake: FakePdfjs,
    readonly number: number,
    private readonly size: FakePageSize,
  ) {}

  getViewport({ scale }: { scale: number }): PdfViewport {
    return { width: this.size.width * scale, height: this.size.height * scale }
  }

  render({ canvas, viewport }: { canvas: RenderCanvas; viewport: PdfViewport }): PdfRenderTask {
    this.renders += 1
    this.fake.renderedOn.push(canvas)

    let settle: () => void = () => {}
    let fail: (reason: Error) => void = () => {}
    const promise = new Promise<void>((resolve, reject) => {
      settle = resolve
      fail = reject
    })

    const task: PdfRenderTask = {
      promise,
      cancel: () => {
        this.cancels += 1
        fail(new Error(`Rendering cancelled, page ${this.number}`))
      },
    }

    // Resolving on a microtask rather than synchronously is what makes the
    // cancellation tests meaningful: `duringRender` runs while the engine is
    // genuinely awaiting a task it has already handed its abort listener to.
    // Anything it throws surfaces through the task, exactly as pdf.js reports a
    // content stream it cannot execute.
    void Promise.resolve().then(() => {
      try {
        this.fake.duringRender?.(this, task, viewport)
        settle()
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })

    return task
  }

  async getTextContent(): Promise<{ items: readonly unknown[] }> {
    this.textReads += 1

    return { items: this.fake.textFor?.(this.number) ?? [] }
  }

  cleanup(): boolean {
    this.cleanups += 1

    return true
  }
}

export interface FakePdfjs {
  /** One entry per `load` call, holding the bytes it was handed. */
  loads: Uint8Array[]
  pages: FakePage[]
  canvases: FakeCanvas[]
  /** The surface each `render` was given, in call order. */
  renderedOn: RenderCanvas[]
  destroys: number
  /** Runs while a page render is in flight, before its task resolves. */
  duringRender?: (page: FakePage, task: PdfRenderTask, viewport: PdfViewport) => void
  /**
   * The text runs one page reports, by 1-based page number.
   *
   * Absent means every page is empty, which is what a scan looks like — and what
   * the render tests, which care about pixels, want to keep costing nothing.
   */
  textFor?: (pageNumber: number) => readonly unknown[]
  load: PdfLoader
  createCanvas: RenderCanvasFactory
}

/**
 * Builds a fake pdf.js over pages of the given sizes, in points.
 *
 * US Letter twice over by default, because the number that matters in most
 * assertions is 612 × 792 turning into pixels at some resolution.
 */
export function fakePdfjs(
  sizes: readonly FakePageSize[] = [
    { width: 612, height: 792 },
    { width: 612, height: 792 },
  ],
  imageBytes: Uint8Array<ArrayBuffer> = new Uint8Array([137, 80, 78, 71]),
): FakePdfjs {
  const fake: FakePdfjs = {
    loads: [],
    pages: [],
    canvases: [],
    renderedOn: [],
    destroys: 0,
    load: async () => {
      throw new Error('replaced below')
    },
    createCanvas: () => {
      throw new Error('replaced below')
    },
  }

  const document: PdfDocument = {
    numPages: sizes.length,
    async getPage(pageNumber: number): Promise<PdfPage> {
      const size = sizes[pageNumber - 1]
      if (size === undefined) throw new Error(`No page ${pageNumber} in this document.`)

      const page = new FakePage(fake, pageNumber, size)
      fake.pages.push(page)

      return page
    },
  }

  fake.load = async (data) => {
    fake.loads.push(data)

    const task: PdfLoadingTask = {
      promise: Promise.resolve(document),
      destroy: async () => {
        fake.destroys += 1
      },
    }

    return task
  }

  fake.createCanvas = (width, height) => {
    const canvas = new FakeCanvas(width, height, imageBytes)
    fake.canvases.push(canvas)

    return canvas
  }

  return fake
}
