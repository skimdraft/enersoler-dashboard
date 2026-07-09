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
    const plants=[
        ['PAEA','1437035','1437035_1_1_2'],
        ['TEMANA','1425869','1425869_1_1_1'],
    ];

    for(const [name,psId,psKey] of plants){
        console.log('\n========== '+name+' (ps_id='+psId+') ==========');
        
        // All points 1-50 in ONE call
        const ids1=[];for(let i=1;i<=50;i++)ids1.push(String(i));
        const r1=await call('/openapi/platform/getDeviceRealTimeData',{ps_key_list:[psKey],point_id_list:ids1,device_type:1});
        if(r1.result_code==='1'){
            const dp=r1.result_data.device_point_list[0].device_point;
            console.log('--- Batch [1-50] ---');
            for(const k in dp){
                const v=dp[k];
                if(v!==null && v!==undefined && parseFloat(v)!==0 && String(v)!=='0.0'){
                    console.log('  '+k+' = '+v);
                }
            }
        }else{console.log('Batch [1-50] FAILED: code='+r1.result_code+' msg='+r1.result_msg);}

        // Points 51-100
        const ids2=[];for(let i=51;i<=100;i++)ids2.push(String(i));
        const r2=await call('/openapi/platform/getDeviceRealTimeData',{ps_key_list:[psKey],point_id_list:ids2,device_type:1});
        if(r2.result_code==='1'){
            const dp=r2.result_data.device_point_list[0].device_point;
            console.log('--- Batch [51-100] ---');
            for(const k in dp){
                const v=dp[k];
                if(v!==null && v!==undefined && parseFloat(v)!==0 && String(v)!=='0.0'){
                    console.log('  '+k+' = '+v);
                }
            }
        }else{console.log('Batch [51-100] FAILED: code='+r2.result_code);}

        // Points 101-120
        const ids3=[];for(let i=101;i<=120;i++)ids3.push(String(i));
        const r3=await call('/openapi/platform/getDeviceRealTimeData',{ps_key_list:[psKey],point_id_list:ids3,device_type:1});
        if(r3.result_code==='1'){
            const dp=r3.result_data.device_point_list[0].device_point;
            console.log('--- Batch [101-120] ---');
            for(const k in dp){
                const v=dp[k];
                if(v!==null && v!==undefined && parseFloat(v)!==0 && String(v)!=='0.0'){
                    console.log('  '+k+' = '+v);
                }
            }
        }else{console.log('Batch [101-120] FAILED: code='+r3.result_code);}

        // Plant detail
        const rs=await call('/openapi/platform/getPowerStationDetail',{ps_ids:psId});
        if(rs.result_code==='1'){
            const d=rs.result_data.data_list[0];
            console.log('--- Plant detail ---');
            console.log('  install_power='+d.install_power);
            for(const k of ['today_energy','total_energy','month_energy','year_energy','cur_power']){
                if(d[k]!==undefined)console.log('  '+k+'='+d[k]);
            }
        }
    }
}
main().catch(e=>console.error('FATAL:',e));
