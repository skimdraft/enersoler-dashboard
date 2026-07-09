const https=require('https'),crypto=require('crypto');

const APPKEY='99927DD8A3562C02F3EEF55045F95419';
const SECRET='dwbumt012186my4mu7ffqzji4a3vrfu5';
const BASE='gateway.isolarcloud.com.hk';

function sign(){
    const ts=String(Math.floor(Date.now()/1000));
    const hash=crypto.createHash('md5').update(APPKEY+ts+SECRET).digest('hex');
    return {ts,hash};
}

function call(p,b,signed=true){
    return new Promise(r=>{
        const headers={
            'Content-Type':'application/json;charset=UTF-8',
            'x-access-key':SECRET,
            'sys_code':'901',
        };
        if(signed){
            const s=sign();
            headers['x-access-key']=APPKEY; // Some APIs use this pattern
            headers['x-ts']=s.ts;
            headers['x-sign']=s.hash;
        }
        const j=JSON.stringify({...b,appkey:APPKEY,lang:'_fr_FR'});
        const q=https.request({hostname:BASE,path:p,method:'POST',headers},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{r(JSON.parse(d))}catch(e){r({raw:d.slice(0,300)})}});});
        q.write(j);q.end();
    });
}

async function test(name,p,body){
    // Try 3 auth variants
    const variants=[
        {label:'MD5 appkey in header', auth:true, appkeyInBody:false},
        {label:'MD5 secret in x-access-key', auth:true, appkeyInBody:true},
        {label:'secret in x-access-key, no sign', auth:false, appkeyInBody:true},
    ];

    for(const v of variants){
        try{
            const headers={'Content-Type':'application/json;charset=UTF-8','sys_code':'901'};
            if(v.auth){
                const s=sign();
                headers['x-ts']=s.ts;
                headers['x-sign']=s.hash;
                headers['x-access-key']=v.appkeyInBody?SECRET:APPKEY;
            } else {
                headers['x-access-key']=SECRET;
            }
            const b2={...body,lang:'_fr_FR'};
            if(!v.appkeyInBody)b2.appkey=APPKEY;
            const j=JSON.stringify(b2);
            const r=await new Promise(resolve=>{
                const q=https.request({hostname:BASE,path:p,method:'POST',headers},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({raw:d.slice(0,200)})}});});
                q.write(j);q.end();
            });
            const code=r.result_code||'?';
            if(code==='1'){
                const keys=r.result_data?Object.keys(r.result_data).slice(0,5).join(','):'?';
                console.log('✅ '+name+' ['+v.label+'] | keys: '+keys);
                // Show first data if available
                if(r.result_data?.data_list)console.log('   data_list length: '+r.result_data.data_list.length);
                if(r.result_data?.pageList)console.log('   pageList length: '+r.result_data.pageList.length);
                if(r.result_data?.ps_power)console.log('   ps_power: '+JSON.stringify(r.result_data.ps_power).slice(0,200));
                return; // Success, stop trying variants
            }else if(code===undefined||code==='?'){
                console.log('❓ '+name+' ['+v.label+']: '+JSON.stringify(r).slice(0,150));
            }else{
                console.log('❌ '+name+' ['+v.label+']: '+code+' '+r.result_msg);
            }
        }catch(e){}
    }
}

async function main(){
    console.log('=== Testing User API (ENERSOLER USER) ===\n');

    const today='2026-07-01';

    // These were E900 with OAuth2
    await test('getStationRealTimeData','/openapi/platform/getStationRealTimeData',{ps_id:'1437035'});
    await test('getPlantPowerData','/openapi/platform/getPlantPowerData',{ps_id:'1437035',date:today});
    await test('getPsDayPower','/openapi/platform/getPsDayPower',{ps_id:'1437035',date:today});
    await test('queryPowerStationList','/openapi/platform/queryPowerStationList',{page:1,size:20});
    await test('getPowerStationDetail','/openapi/platform/getPowerStationDetail',{ps_ids:'1437035'});
}

main().catch(e=>console.error(e));
