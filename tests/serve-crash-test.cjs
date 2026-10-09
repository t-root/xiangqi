const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const target=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
 if(!target.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 const type=target.endsWith('.wasm')?'application/wasm':target.endsWith('.js')?'text/javascript':'text/html';
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Content-Type',type);
 fs.readFile(target,(e,data)=>{res.statusCode=e?404:200;res.end(e?'Not found':data);});
});
server.listen(19998,'127.0.0.1',()=>console.log('Test server http://127.0.0.1:19998/tests/browser/wasm-crash-test.html'));
setTimeout(()=>server.close(),600000).unref();
