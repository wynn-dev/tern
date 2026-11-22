import { ImageOffIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const hasRemoteImages = (html: string) => /<img[^>]+src=["']?https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);

/**
 * Renders an HTML email in a sandboxed iframe: no scripts, links open in a new
 * tab, and remote images (tracking pixels) stay blocked until asked for.
 */
export function EmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [images, setImages] = useState(false);
  const remote = useMemo(() => hasRemoteImages(html), [html]);

  const doc = useMemo(() => {
    const img = images ? "img-src data: cid: https: http:;" : "img-src data: cid:;";
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${img} style-src 'unsafe-inline' https:; font-src data: https:;">
<base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#18181b}
  body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:16px 18px;overflow-wrap:anywhere}
  img{max-width:100%;height:auto}
  table{max-width:100%!important}
  blockquote{margin:0 0 0 .5em;padding-left:.8em;border-left:2px solid #e4e4e7;color:#52525b}
  a{color:#4f46e5}
</style></head><body>${html}</body></html>`;
  }, [html, images]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let obs: ResizeObserver | undefined;
    const onLoad = () => {
      const body = frame.contentDocument?.body;
      if (!body) return;
      const measure = () => setHeight(Math.ceil(frame.contentDocument!.documentElement.scrollHeight));
      measure();
      obs = new ResizeObserver(measure);
      obs.observe(body);
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      obs?.disconnect();
    };
  }, [doc]);

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      {remote && !images && (
        <button
          onClick={() => setImages(true)}
          className="flex w-full items-center gap-2 border-b bg-zinc-50 px-3 py-1.5 text-left text-[12px] text-zinc-500 hover:text-zinc-900"
        >
          <ImageOffIcon className="size-3.5" />
          Remote images are blocked to stop tracking. <span className="font-medium text-indigo-600">Load images</span>
        </button>
      )}
      <iframe
        ref={ref}
        title="Email"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        style={{ height }}
        className="block w-full border-0"
      />
    </div>
  );
}
