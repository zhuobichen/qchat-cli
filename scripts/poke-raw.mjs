const TOKEN='75277e324f924d73255a5d0b77543e035af0e509bc7d7559';
const ws=new WebSocket(`ws://127.0.0.1:3000/?access_token=${TOKEN}`);
ws.addEventListener('message',e=>{const j=JSON.parse(String(e.data));if(j.post_type==='notice'&&j.sub_type==='poke')console.log(JSON.stringify(j));});
setTimeout(()=>process.exit(0),18000);
