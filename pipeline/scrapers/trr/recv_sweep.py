import http.server, sys
OUT=sys.argv[1]
PAGE=b"""<!doctype html><meta charset=utf-8><title>saving sweep</title><body style="font:20px sans-serif;padding:40px">Saving...<script>
(async()=>{const h=location.hash.slice(1);const bin=Uint8Array.from(atob(h.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const txt=await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const r=await fetch('/save',{method:'POST',body:txt});document.body.textContent=r.ok?('Saved '+txt.split('\\n').length+' rows. You can close this tab.'):'Save failed';})();
</script>"""
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('content-type','text/html'); self.end_headers(); self.wfile.write(PAGE)
    def do_POST(self):
        n=int(self.headers.get('content-length',0)); b=self.rfile.read(n)
        open(OUT,'wb').write(b); self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
    def log_message(self,*a): pass
http.server.HTTPServer(('127.0.0.1',8766),H).serve_forever()
