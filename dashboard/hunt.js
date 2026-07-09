const https=require('https'),fs=require('fs');
const T=JSON.parse(fs.readFileSync(__dirname+'/isolar-tokens.json','utf8'));
const E={};fs.readFileSync(__dirname+'/../.env','utf8').split('\n').forEach(l=>{const m=l.match(/^([^#].*?)=(.*)$/);if(m)E[m[1].trim()]=m[2].trim();});

function call(p,b){
    return new Promise(r=>{
        const headers={'Content-Type':'application/json;charset=UTF-8','x-access-key':E.ISOLAR_APP_SECRET,'sys_code':'901'};
        headers['Authorization']='Bearer '+T.accessToken;
        const j=JSON.stringify({...b,appkey:E.ISOLAR_APP_KEY,lang:'_fr_FR'});
        const q=https.request({hostname:'gateway.isolarcloud.com.hk',path:p,method:'POST',headers},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{r(JSON.parse(d))}catch(e){r({raw:d})}});});
        q.write(j);q.end();
    });
}

async function main(){
    const today='2026-07-01';
    const psKey='1437035_1_1_2';
    const psId='1437035';

    const tests=[
        ['getPsDayPower', '/openapi/platform/getPsDayPower', {ps_id:psId, date:today}],
        ['getPlantDayEnergy', '/openapi/platform/getPlantDayEnergy', {ps_id:psId, date:today}],
        ['getPlantPowerByDay', '/openapi/platform/getPlantPowerByDay', {ps_id:psId, date:today}],
        ['getDevicePointMinute', '/openapi/platform/getDevicePointMinute', {ps_key:psKey, point_id:'24',start_time:today+' 06:00:00',end_time:today+' 18:00:00'}],
        ['getDevicePointData', '/openapi/platform/getDevicePointData', {ps_key:psKey, ps_id:psId, point_id:'24',start_time:today+' 06:00',end_time:today+' 18:00'}],
        ['queryDevicePowerCurve', '/openapi/platform/queryDevicePowerCurve', {ps_key:psKey, date:today}],
        ['getDeviceDayData', '/openapi/platform/getDeviceDayData', {ps_key:psKey, date:today}],
        ['queryStationPowerData', '/openapi/platform/queryStationPowerData', {ps_id:psId, start_date:today, end_date:today, time_dimension:1}],
        ['getPsPowerData', '/openapi/platform/getPsPowerData', {ps_id:psId, date:today}],
        ['queryRealtimeData', '/openapi/platform/queryRealtimeData', {ps_id:psId}],
        ['getDayPowerCurve', '/openapi/platform/getDayPowerCurve', {ps_id:psId, date:today}],
        // Try the WiNet-S2 module  
        ['WiNet getDeviceRealTimeData', '/openapi/platform/getDeviceRealTimeData', {ps_key_list:['1437035_22_247_2'], point_id_list:['1','2','3','4','5'], device_type:22}],
    ];

    for(const [name, path, body] of tests){
        try{
            const r=await call(path, body);
            const code=r.result_code||'no_code';
            const msg=r.result_msg||'';
            const hasData=r.result_data?Object.keys(r.result_data).slice(0,4).join(','):'no_data';
            if(code==='1'){
                console.log('✅ '+name+' | keys:'+hasData);
                console.log('   '+JSON.stringify(r).slice(0,200));
            }else if(code==='no_code'||code===undefined){
                console.log('❓ '+name+' | '+JSON.stringify(r).slice(0,120));
            }else{
                console.log('❌ '+name+' | '+code+' '+msg);
            }
        }catch(e){console.log('💥 '+name+' | '+e.message);}
    }
}
main();
