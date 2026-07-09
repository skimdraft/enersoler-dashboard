const https=require('https'),fs=require('fs');
const T=JSON.parse(fs.readFileSync(__dirname+'/isolar-tokens.json','utf8'));
const E={};fs.readFileSync(__dirname+'/../.env','utf8').split('\n').forEach(l=>{const m=l.match(/^([^#].*?)=(.*)$/);if(m)E[m[1].trim()]=m[2].trim();});

function call(p,b){
    return new Promise(r=>{
        const headers={'Content-Type':'application/json;charset=UTF-8','x-access-key':E.ISOLAR_APP_SECRET,'sys_code':'901'};
        headers['Authorization']='Bearer '+T.accessToken;
        const j=JSON.stringify({...b,appkey:E.ISOLAR_APP_KEY,lang:'_fr_FR'});
        const q=https.request({hostname:'gateway.isolarcloud.com.hk',path:p,method:'POST',headers},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r(JSON.parse(d)));});
        q.write(j);q.end();
    });
}

async function main(){
    // 1) Plant list (all fields)
    console.log('=== queryPowerStationList ===');
    const r1=await call('/openapi/platform/queryPowerStationList',{page:1,size:20});
    if(r1.result_code==='1' && r1.result_data?.pageList){
        for(const ps of r1.result_data.pageList){
            console.log('\n'+ps.ps_name+' (id='+ps.ps_id+'):');
            for(const k in ps){
                if(ps[k]!==null && ps[k]!==undefined && ps[k]!=='' && k!=='ps_name' && k!=='ps_id'){
                    console.log('  '+k+' = '+JSON.stringify(ps[k]));
                }
            }
        }
    }

    // 2) Plant detail (ALL fields)
    console.log('\n\n=== getPowerStationDetail ===');
    for(const psId of ['1437035','1425869']){
        const r=await call('/openapi/platform/getPowerStationDetail',{ps_ids:psId});
        if(r.result_code==='1' && r.result_data?.data_list){
            const d=r.result_data.data_list[0];
            console.log('\n'+d.ps_name+':');
            for(const k in d){
                if(d[k]!==null && d[k]!==undefined && d[k]!==''){
                    console.log('  '+k+' = '+JSON.stringify(d[k]));
                }
            }
        }
    }

    // 3) Device list (ALL fields)
    console.log('\n\n=== getDeviceListByPsId ===');
    for(const psId of ['1437035','1425869']){
        const r=await call('/openapi/platform/getDeviceListByPsId',{ps_id:psId,page:1,size:50});
        if(r.result_code==='1' && r.result_data?.pageList){
            for(const dev of r.result_data.pageList){
                console.log('\nDevice (ps_id='+psId+'):');
                for(const k in dev){
                    if(dev[k]!==null && dev[k]!==undefined && dev[k]!==''){
                        console.log('  '+k+' = '+JSON.stringify(dev[k]));
                    }
                }
            }
        }
    }
}
main().catch(e=>console.error('FATAL:',e));
