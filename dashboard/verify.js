const https=require('https'),fs=require('fs');
const T=JSON.parse(fs.readFileSync(__dirname+'/isolar-tokens.json','utf8'));
const E={};fs.readFileSync(__dirname+'/../.env','utf8').split('\n').forEach(l=>{const m=l.match(/^([^#].*?)=(.*)$/);if(m)E[m[1].trim()]=m[2].trim();});
const token=T.accessToken;

function call(p,b){
  return new Promise(r=>{
    const j=JSON.stringify({...b,appkey:E.ISOLAR_APP_KEY,lang:'_fr_FR'});
    const q=https.request({
      hostname:'gateway.isolarcloud.com.hk',path:p,method:'POST',
      headers:{'Content-Type':'application/json;charset=UTF-8','x-access-key':E.ISOLAR_APP_SECRET,'sys_code':'901',Authorization:'Bearer '+token}
    },res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r(JSON.parse(d)));});
    q.write(j);q.end();
  });
}

async function main(){
  for(const [name,pk] of [['PAEA','1437035_1_1_2'],['TEMANA','1425869_1_1_1']]){
    const r=await call('/openapi/platform/getDeviceRealTimeData',{ps_key_list:[pk],point_id_list:['1','2','3','4','14','24','86','88'],device_type:1});
    console.log(name+': code='+r.result_code);
    const dp=r.result_data?.device_point_list?.[0]?.device_point;
    if(dp){
      for(const k of ['p1','p2','p3','p4','p14','p24','p86','p88'])
        console.log('  '+k+' = '+dp[k]);
    }else{
      console.log('  NO DEVICE POINT');
      console.log('  data keys:',r.result_data?Object.keys(r.result_data):'null');
    }
  }
}
main().catch(e=>console.error(e));
