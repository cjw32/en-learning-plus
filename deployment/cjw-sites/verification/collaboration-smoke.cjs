const Y = require('yjs');
const {WebsocketProvider} = require('y-websocket');
const WS = require('ws');
const [url,room,mode]=process.argv.slice(2);
const doc = new Y.Doc();
const provider = new WebsocketProvider(url,room,doc,{WebSocketPolyfill:WS,disableBc:true});
const timer=setTimeout(()=>{console.error('sync timeout');process.exit(1)},15000);
provider.on('sync', synced=>{
 if(!synced)return;
 const map=doc.getMap('migration-test');
 if(mode==='write') map.set('value','persisted-after-restart');
 
 setTimeout(()=>{if(mode==='read' && map.get('value')!=='persisted-after-restart'){console.error('persistence mismatch');process.exit(1)}provider.destroy();doc.destroy();clearTimeout(timer);console.log(mode+' PASS');process.exit(0)},1500);
});
