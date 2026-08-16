type SynchronizedImageZoomProps = {
  beforeUrl: string
  afterUrl: string
  subject: string
}

// The synchronized Patch crop experiment was removed after interface review.
// Keep this temporary no-op export until its call sites are cleaned up with the
// surrounding one-line flow markup.
export function SynchronizedImageZoom(_props: SynchronizedImageZoomProps) {
  void _props
  return null
}
