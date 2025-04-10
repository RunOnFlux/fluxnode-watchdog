const shell = require('shelljs');
const sleep = require('sleep');
const moment = require('moment');
const webhook = require("@prince25/discord-webhook-sender")
const fs = require('fs');
const fsPromises = require('fs/promises');
const axios = require('axios');
const path = require('node:path');

sleep.sleep(15);
console.log('Watchdog v6.4.3 Starting...');
console.log('=================================================================');

const configPath = 'config.js';

const isArcane = Boolean(process.env.FLUXOS_PATH);
const fluxdConfigPath = process.env.FLUXD_CONFIG_PATH;
const fluxbenchPath = process.env.FLUXBENCH_PATH;
const fluxOsRootDir = process.env.FLUXOS_PATH || "/home/$USER/zelflux";
const fluxOsConfigPath = path.join(fluxOsRootDir, "config/userconfig.js")
const fluxdServiceName = isArcane ? "fluxd.service" : "zelcash.service";
const historyFilePath = path.join(__dirname, 'history.json');

let arcaneVersionHistory = '';
let arcaneVersionHumanHistory = '';
let debounceTimeout;

var sync_lock = 0;
var tire_lock=0;
var lock_zelback=0;
var zelcashd_counter=0;
var zelbench_counter=0;
var zelbench_daemon_counter=0;
var inactive_counter=0;
var mongod_counter=0;
var paid_local_time="N/A";
var expiried_time="N/A";
var watchdog_sleep="N/A";
var disc_count = 0;
var h_IP=0;
var component_update=0;
var job_count=0;
var sleep_msg=0;

function between(min, max) {
  return Math.floor(
    Math.random() * (max - min) + min
  )
}

let autoUpdate = between(60, 240); // auto update will now be different on each node and checks are defined between 1 and 4h.
async function job_creator(){
  try{
    ++job_count;

    if ( job_count % autoUpdate === 0 ) {
      await auto_update();
    }
    if ( job_count % 4   === 0 ) {
      await flux_check();
    }
    // reset job count
    if ( job_count % autoUpdate === 0 ) {
      job_count = 0;
      autoUpdate = between(60, 240);
    }
  } finally {
    sleep.sleep(60);
    job_creator();
  }
}

function checkIfValidIP(str) {
  // Regular expression to check if string is a IP address
  const regexExp = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
  return regexExp.test(str);
}

async function Myip(){
  const check_list = ['ifconfig.me', 'api4.my-ip.io/ip', 'checkip.amazonaws.com' , 'api.ipify.org'];
  var MyIP = null;
  for (const [index, val] of check_list.entries()) {
    MyIP = await shell.exec(`curl -sk -m 10 https://${val} | tr -dc '[:alnum:].'`,{ silent: true }).stdout;

    if (checkIfValidIP(MyIP)){
      break;
    }

  }

  if ( MyIP != "" ){
    h_IP=MyIP;
    /* console.log(`Saved IP for historical usage.`); */
  }

  if ( MyIP == "" ){
    MyIP=h_IP;
    console.log(`Info: Historical IP used.`);
  }

return MyIP;
}

async function discord_hook(node_msg, web_hook_url, ping, title, color, field_name, thumbnail_png, label) {

  if (typeof web_hook_url !== "undefined" && web_hook_url !== "0") {
    try {
      const node_ip = await Myip();
      var api_port = shell.exec(`grep -w apiport ${fluxOsConfigPath} | grep -o '[[:digit:]]*'`, { silent: true });
      if (api_port == "") {
        var ui_port = 16126;
      } else {
        var ui_port = Number(api_port.trim()) - 1;
      }

      const Hook = new webhook.Webhook(`${web_hook_url}`);
      Hook.setUsername('Flux Watchdog');

      // Construct the message based on ping and label
      let msg;
      if (typeof ping == "undefined" || ping == "0") {
        if (typeof label == "undefined") {
          msg = new webhook.MessageBuilder()
            .setTitle(`:loudspeaker: **FluxNode ${title}**`)
            .addField('URL:', `http://${node_ip}:${ui_port}`)
            .addField(`${field_name}:`, node_msg)
            .setColor(`${color}`)
            .setThumbnail(`https://fluxnodeservice.com/images/${thumbnail_png}`);
        } else {
          msg = new webhook.MessageBuilder()
            .setTitle(`:loudspeaker: **FluxNode ${title}**`)
            .addField('Name:', `${label}`)
            .addField('URL:', `http://${node_ip}:${ui_port}`)
            .addField(`${field_name}:`, node_msg)
            .setColor(`${color}`)
            .setThumbnail(`https://fluxnodeservice.com/images/${thumbnail_png}`);
        }
      } else {
        if (typeof label == "undefined") {
          msg = new webhook.MessageBuilder()
            .setTitle(`:loudspeaker: **FluxNode ${title}**`)
            .addField('URL:', `http://${node_ip}:${ui_port}`)
            .addField(`${field_name}:`, node_msg)
            .setColor(`${color}`)
            .setThumbnail(`https://fluxnodeservice.com/images/${thumbnail_png}`)
            .setText(`Ping: <@${ping}>`);
        } else {
          msg = new webhook.MessageBuilder()
            .setTitle(`:loudspeaker: **FluxNode ${title}**`)
            .addField('Name:', `${label}`)
            .addField('URL:', `http://${node_ip}:${ui_port}`)
            .addField(`${field_name}:`, node_msg)
            .setColor(`${color}`)
            .setThumbnail(`https://fluxnodeservice.com/images/${thumbnail_png}`)
            .setText(`Ping: <@${ping}>`);
        }
      }

      await Hook.send(msg);
      console.log('Discord webhook message sent successfully');
    } catch (error) {
      console.error('Error sending Discord webhook message:', error.message);
    }
  } 
}

function max() {
    var args = Array.prototype.slice.call(arguments);
    return Math.max.apply(Math, args.filter(function(val) {
       return !isNaN(val);
    }));
}

async function Check_Sync(height,time) {
  // var exec_comment1=`curl -sk -m 8 https://explorer.flux.zelcore.io/api/status?q=getInfo | jq '.info.blocks'`
  var exec_comment2=`curl -sk -m 8 https://explorer.runonflux.io/api/status?q=getInfo | jq '.info.blocks'`
  var exec_comment3=`curl -sk -m 8 https://explorer.zelcash.online/api/status?q=getInfo | jq '.info.blocks'`
 // var explorer_block_height_01 = await shell.exec(`${exec_comment1}`,{ silent: true }).stdout;
  var explorer_block_height_02 = await shell.exec(`${exec_comment2}`,{ silent: true }).stdout;
  var explorer_block_height_03 = await shell.exec(`${exec_comment3}`,{ silent: true }).stdout;
  var explorer_block_height = max(explorer_block_height_02,explorer_block_height_03);
  var height_diff = Math.abs(explorer_block_height-height);

  if ( explorer_block_height == 0 ) {
    console.log(`Info: Flux network height unavailable! Check Skipped...`);
    return;
  }

  if ( height > explorer_block_height ) {
    console.log(`Info: Flux node height > network height! Check Skipped...`);
    return;
  }


  if ( height_diff < 12 ) {

     if ( sync_lock != 0 ) {

        if ( typeof action  == "undefined" || action == "1" ){

           await discord_hook("Flux daemon is synced!",web_hook_url,ping,'Fix Info','#1F8B4C','Info','watchdog_fixed2.png',label);

           // Sync Fixed notification telegram
           var emoji_title = '\u{1F4A1}';
           var emoji_fixed = '\u{2705}';
           var info_type = 'Fixed Info '+emoji_fixed;
           var field_type = 'Info: ';
           var msg_text = 'Flux daemon is synced!';
           await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

        }

     }

    console.log(`Flux daemon is synced (${height}, diff: ${height_diff})`);
    sync_lock = 0;

  } else {

    console.log(`Flux daemon is not synced (${height}, diff: ${height_diff})`);
    if ( sync_lock == 0 ) {

       await discord_hook(`Flux daemon is not synced!\nDaemon height: **${height}**\nNetwork height: **${explorer_block_height}**\nDiff: **${height_diff}**`,web_hook_url,ping,'Alert','#EA1414','Error','watchdog_error1.png',label);

       // Sync problem
       var emoji_title = '\u{1F6A8}';
       var emoji_bell = '\u{1F514}';
       var info_type = 'Alert '+emoji_bell;
       var field_type = 'Error: ';
       var msg_text = "Flux daemon is not synced! \n<b>Daemon height: </b>"+height+"\n<b>Network height: </b>"+explorer_block_height+"\n<b>Diff: </b>"+height_diff;
       await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);



       if ( typeof action  == "undefined" || action == "1" ){


         shell.exec(`sudo systemctl stop ${fluxdServiceName}`,{ silent: true });
         sleep.sleep(2);
         if (!isArcane) shell.exec("sudo fuser -k 16125/tcp",{ silent: true });
         shell.exec(`sudo systemctl start ${fluxdServiceName}`,{ silent: true });
         console.log(time+' => Flux daemon restarting...');
         await discord_hook("Flux daemon restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

         // Fix action telegram
         var emoji_title = '\u{26A1}';
         var emoji_fix = '\u{1F528}';
         var info_type = 'Fix Action '+emoji_fix;
         var field_type = 'Info: ';
         var msg_text = 'Flux daemon restarted!';
         await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

       }

      sync_lock = 1;
    }

  }
}

if (fs.existsSync(configPath)) {
  var home_dir = shell.exec("echo $HOME",{ silent: true }).stdout;
  var daemonConfigPath = `${home_dir.trim()}/.zelcash/zelcash.conf`;
  var daemon_cli='zelcash-cli';

  if (fs.existsSync(`/usr/local/bin/flux-cli`)) {
     daemon_cli = isArcane
       ? `flux-cli -conf=${fluxdConfigPath}`
       : "flux-cli";
  }

  if (!fs.existsSync(daemonConfigPath)) {
    daemonConfigPath = fluxdConfigPath || `${home_dir.trim()}/.flux/flux.conf`;
   }


  if (fs.existsSync(`/usr/local/bin/fluxbenchd`)) {
     bench_cli='fluxbench-cli';
   } else {
     bench_cli='zelbench-cli';
   }


  if (fs.existsSync(daemonConfigPath)) {
    var tx_hash = shell.exec(`grep -w zelnodeoutpoint "${daemonConfigPath}" | sed -e 's/zelnodeoutpoint=//'`,{ silent: true }).stdout;
    var exec_comment = `${daemon_cli} decoderawtransaction $(${daemon_cli} getrawtransaction ${tx_hash} ) | jq '.vout[].value' | egrep '1000|12500|40000'`
    var type = shell.exec(exec_comment,{ silent: true }).stdout;
    switch(Number(type.trim())){
      case 1000:
      var  tire_name="CUMULUS";
      break;

      case 12500:
      var  tire_name="NIMBUS";
      break;

      case 40000:
      var  tire_name="STRATUS";
      break;

      default:
      var  tire_name="UNKNOW";
    }

} else {

    var  tire_name="UNKNOW";
  }


var config = require('./config.js');
var eps_limit=config.tier_eps_min;
var web_hook_url=config.web_hook_url;
var action=config.action;
var ping=config.ping;
var telegram_alert = config.telegram_alert;
var label= config.label;

console.log('Config file:');
console.log(`Tier: ${tire_name}`);
console.log(`Minimum eps: ${eps_limit}`);
if (typeof action == "undefined" || action == "1" )
{
console.log('Fix action:  enabled');
} else {
console.log('Fix action:  disabled');
}

if (typeof web_hook_url !== "undefined" && web_hook_url !== "0" )
{
console.log('Discord alert:  enabled');

if (typeof ping !== "undefined" && ping !== "0" ){
console.log('Discord ping:  enabled');
} else {
console.log('Discord ping:  disabled');
}



} else {
console.log('Discord alert:  disabled');
}

if (typeof telegram_alert !== "undefined" && telegram_alert !== "0" )
{
console.log('Telegram alert:  enabled');
} else {
console.log('Telegram alert:  disabled');
}


console.log(`Update settings:`);
if ( config.zelcash_update == "1" ) {
console.log('=> Flux daemon:  enabled');
} else {
console.log('=> Flux daemon:  disabled');
}
if ( config.zelbench_update == "1" ) {
console.log('=> Fluxbench: enabled');
} else {
console.log('=> Fluxbench: disabled');
}
if ( config.zelflux_update == "1" ) {
console.log('=> FluxOS:  enabled');
} else {
console.log('=> FluxOS:  disabled');
}
console.log('=================================================================');
}
else {
  const home_dir = shell.exec("echo $HOME",{ silent: true }).stdout;
  let daemonConfigPath = `${home_dir.trim()}/.zelcash/zelcash.conf`;
  var daemon_cli='zelcash-cli';
  var bench_cli='zelbench-cli';

  if (fs.existsSync(`/usr/local/bin/flux-cli`)) {
    daemon_cli = isArcane
    ? `flux-cli -conf=${fluxdConfigPath}`
    : "flux-cli";
  }

  if (!fs.existsSync(daemonConfigPath)) {
    daemonConfigPath = isArcane
       ? fluxdConfigPath
       : `${home_dir.trim()}/.flux/flux.conf`;
   }


  if (fs.existsSync(`/usr/local/bin/fluxbenchd`)) {
     bench_cli='fluxbench-cli';
  }

  if (fs.existsSync(daemonConfigPath)) {
   var tx_hash = shell.exec(`grep -w zelnodeoutpoint "${daemonConfigPath}" | sed -e 's/zelnodeoutpoint=//'`,{ silent: true }).stdout;
   var exec_comment = `${daemon_cli} decoderawtransaction $(${daemon_cli} getrawtransaction ${tx_hash} ) | jq '.vout[].value' | egrep '1000|12500|40000'`
   var type = shell.exec(`${exec_comment}`,{ silent: true }).stdout;

   switch(Number(type.trim())){
       case 1000:
       var  tire_name="CUMULUS";
       var eps_limit = 90;
       break;

       case 12500:
       var  tire_name="NIMBUS";
       var eps_limit = 180
       break;

       case 40000:
       var  tire_name="STRATUS";
       var eps_limit = 300
       break;

       default:
       var  tire_name="UNKNOW";
       var eps_limit = 0;

  }

} else {
    var eps_limit = 0;
    var  tire_name="UNKNOW";
}


const dataToWrite = `module.exports = {
  tier_eps_min: '${eps_limit}',
  zelflux_update: '0',
  zelcash_update: '0',
  zelbench_update: '0',
  action: '1',
  ping: '0';
  web_hook_url: '0';
  telegram_alert: '0';
  telegram_bot_token: '0';
  telegram_chat_id: '0'
}`;

console.log('Creating config file...');
console.log("========================");

const userconfig = fs.createWriteStream(configPath);
  userconfig.once('open', () => {
  userconfig.write(dataToWrite);
  userconfig.end();
});

sleep.sleep(3);
var config = require('./config.js');
var web_hook_url=config.web_hook_url;
var action=config.action;
var ping=config.ping;
var telegram_alert = config.telegram_alert;

console.log('Config file:');
console.log(`Tier: ${tire_name}`);
console.log(`Minimum eps: ${eps_limit}`);
if (typeof action == "undefined" || action == "1" )
{
console.log('Fix action:  enabled');
} else {
console.log('Fix action:  disabled');
}

if (typeof web_hook_url !== "undefined" && web_hook_url !== "0" )
{
console.log('Discord alert:  enabled');

if (typeof ping !== "undefined" && ping !== "0" ) {
console.log('Discord ping:  enabled');
} else {
console.log('Discord ping:  disabled');
}


} else {
console.log('Discord alert:  disabled');
}

if (typeof telegram_alert !== "undefined" && telegram_alert !== "0" )
{
console.log('Telegram alert:  enabled');
} else {
console.log('Telegram alert:  disabled');
}

console.log(`Update settings:`);
if ( config.zelcash_update == "1" ) {
console.log('=> Flux daemon:  enabled');
} else {
console.log('=> Flux daemon:  disabled');
}
if ( config.zelbench_update == "1" ) {
console.log('=> Fluxbench: enabled');
} else {
console.log('=> Fluxbench: disabled');
}
if ( config.zelflux_update == "1" ) {
console.log('=> FluxOS:  enabled');
} else {
console.log('=> FluxOS:  disabled');
}
console.log('=================================================================');

}

async function send_telegram_msg(emoji_title, info_type, field_type, msg_text, label) {
  var telegram_alert = config.telegram_alert;

  if (typeof telegram_alert !== "undefined" && telegram_alert == 1) {
    try {
      const node_ip = await Myip();
      var api_port = shell.exec(`grep -w apiport ${fluxOsConfigPath} | grep -o '[[:digit:]]*'`, { silent: true });
      if (api_port == "") {
        var ui_port = 16126;
      } else {
        var ui_port = Number(api_port.trim()) - 1;
      }

      const token = config.telegram_bot_token;
      const chatId = config.telegram_chat_id;
      const telegramApiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
      let messageText;
      if (typeof label === "undefined") {
        messageText = `${emoji_title}<b> FluxNode Watchdog </b>${emoji_title}\n----------------------------------------\n<b>Type: </b>${info_type}\n<b>URL:</b> http://${node_ip}:${ui_port}\n<b>${field_type}</b>${msg_text}`;
      } else {
        messageText = `${emoji_title}<b> FluxNode Watchdog </b>${emoji_title}\n----------------------------------------\n<b>Type: </b>${info_type}\n<b>Name: </b>${label}\n<b>URL:</b> http://${node_ip}:${ui_port}\n<b>${field_type}</b>${msg_text}`;
      }
      
      await axios.post(telegramApiUrl, {
        chat_id: chatId,
        text: messageText,
        parse_mode: 'HTML',
      });

      console.log('Telegram webhook message sent successfully');
    } catch (error) {
      console.error('Error sending Telegram message:', error.message);
    }
  }
}

function getFilesizeInBytes(filename) {
  try {
    const stats = fs.statSync(filename);
    const fileSizeInBytes = stats.size;
    return fileSizeInBytes;
  } catch {
    return 0;
  }
}

function error(args) {
  try {
    //console.error(args);
    // write to file
    const filepath = `watchdog_error.log`;
    const size = getFilesizeInBytes(filepath);
    let flag = 'a+';
    if (size > (25 * 1000 * 1000)) { // 25MB
      flag = 'w'; // rewrite file
    }
    const data_error = moment.utc().format('YYYY-MM-DD HH:mm:ss');
    const stream = fs.createWriteStream(filepath, { flags: flag });
    stream.write(`${data_error} => ${args}\n`);
    stream.end();
  } catch (err) {
    console.error('This shall not have happened');
    console.error(err);
  }
}

async function auto_update() {
  const watchdogPath = process.env.FLUX_WATCHDOG_PATH || '/home/$USER/watchdog';

  const fluxOsStopCmd = isArcane
    ? "systemctl stop fluxos.service"
    : "pm2 stop flux";

  const fluxOsStartCmd = isArcane
    ? "systemctl start fluxos.service"
    : "pm2 start flux";

  const fluxOsInstallCmd = isArcane
    // just use a dummy command here for non arcane
    ? `cd ${fluxOsRootDir} && npm install --omit=dev --cache /dat/usr/lib/npm`
    : ":";

  const fluxOsPkgFile = path.join(fluxOsRootDir, "package.json");

  delete require.cache[require.resolve('./config.js')];
  var config = require('./config.js');
  var remote_version = shell.exec("curl -sS -m 5 https://raw.githubusercontent.com/RunOnFlux/fluxnode-watchdog/master/package.json | jq -r '.version'",{ silent: true }).stdout;
  var local_version = shell.exec("jq -r '.version' package.json",{ silent: true }).stdout;
  console.log(' UPDATE CHECKING....');
  console.log('=================================================================');
  console.log(`Watchdog current: ${remote_version.trim()} installed: ${local_version.trim()}`);
  if ( remote_version.trim() != "" && local_version.trim() != "" ){
    if ( remote_version.trim() !== local_version.trim()){
      console.log('New watchdog version detected:');
      console.log('=================================================================');
      console.log('Local version: '+local_version.trim());
      console.log('Remote version: '+remote_version.trim());
      console.log('=================================================================');
      shell.exec(`cd ${watchdogPath} && git checkout . && git fetch && git pull -p`,{ silent: true }).stdout;
      var local_ver = shell.exec("jq -r '.version' package.json",{ silent: true }).stdout;
      if ( local_ver.trim() == remote_version.trim() ){
        await discord_hook(`Fluxnode Watchdog updated!\nVersion: **${remote_version}**`,web_hook_url,ping,'Update','#1F8B4C','Info','watchdog_update1.png',label);

        // Update notification Watchdog telegram
       var emoji_title = '\u{23F0}';
        var emoji_update='\u{1F504}';
        var info_type = 'New Update '+emoji_update;
        var field_type = 'Info: ';
        var msg_text = "Fluxnode Watchdog updated! \n<b>Version: </b>"+remote_version;
        await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

        console.log('Update successfully.');
      }
      sleep.sleep(20);
      console.log(' ');
    }
  }
  if (config.zelflux_update == "1") {

   var zelflux_remote_version = shell.exec("curl -sS -m 5 https://raw.githubusercontent.com/RunOnFlux/flux/master/package.json | jq -r '.version'",{ silent: true }).stdout;
   var zelflux_local_version = shell.exec(`jq -r '.version' ${fluxOsPkgFile}`,{ silent: true }).stdout;

   console.log(`FluxOS current: ${zelflux_remote_version.trim()} installed: ${zelflux_local_version.trim()}`);
   if ( zelflux_remote_version.trim() != "" && zelflux_local_version.trim() != "" ){

     if ( zelflux_remote_version.trim() !== zelflux_local_version.trim() ){
       component_update = 1;
       console.log('New FluxOS version detected:');
       console.log('=================================================================');
       console.log('Local version: '+zelflux_local_version.trim());
       console.log('Remote version: '+zelflux_remote_version.trim());
       console.log('=================================================================');
       shell.exec(fluxOsStopCmd,{ silent: true }).stdout;
       sleep.sleep(5);
       shell.exec(`cd ${fluxOsRootDir} && git checkout . && git fetch && git pull -p`,{ silent: true }).stdout;
       sleep.sleep(5);
       shell.exec(fluxOsInstallCmd,{ silent: true }).stdout;
       if (isArcane) sleep.sleep(5);
       shell.exec(fluxOsStartCmd,{ silent: true }).stdout;
       sleep.sleep(20);
       var zelflux_lv = shell.exec(`jq -r '.version' ${fluxOsPkgFile}`,{ silent: true }).stdout;
       if ( zelflux_remote_version.trim() == zelflux_lv.trim() ) {

         await discord_hook(`FluxOS updated!\nVersion: **${zelflux_remote_version}**`,web_hook_url,ping,'Update','#1F8B4C','Info','watchdog_update1.png',label);

         // Update notification FluxOS telegram
         var emoji_title = '\u{23F0}';
         var emoji_update='\u{1F504}';
         var info_type = 'New Update '+emoji_update;
         var field_type = 'Info: ';
         var msg_text = "FluxOS updated!\n<b>Version: </b>"+zelflux_remote_version;
         await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

         console.log('Update successfully.');
        }
        sleep.sleep(20);
       console.log(' ');
    }
   }
  }
  if (config.zelcash_update == "1") {
    var zelcash_remote_version = shell.exec("curl -s -m 5 https://apt.runonflux.io/pool/main/f/flux/ | grep -o '[0-9].[0-9].[0-9]' | head -n1",{ silent: true }).stdout;
    var zelcash_local_version = shell.exec(`dpkg -l flux | grep -w flux | awk '{print $3}'`,{ silent: true }).stdout;
    console.log(`Flux daemon current: ${zelcash_remote_version.trim()} installed: ${zelcash_local_version.trim()}`);
    if ( zelcash_remote_version.trim() != "" && zelcash_local_version.trim() != "" ){
      if ( zelcash_remote_version.trim() !== zelcash_local_version.trim() ){
      component_update = 1;
      console.log('New Flux daemon version detected:');
      console.log('=================================================================');
      console.log('Local version: '+zelcash_local_version.trim());
      console.log('Remote version: '+zelcash_remote_version.trim());
      var  update_info = shell.exec("ps -C apt,apt-get,dpkg >/dev/null && echo 'installing software' || echo 'all clear'",{ silent: true }).stdout;
      if ( update_info == "installing software" ) {

        shell.exec("sudo killall apt",{ silent: true }).stdout;
        shell.exec("sudo killall apt-get",{ silent: true }).stdout;
        shell.exec("sudo dpkg --configure -a",{ silent: true }).stdout;

      }
      var zelcash_dpkg_version_before = shell.exec(`dpkg -l flux | grep -w flux | awk '{print $3}'`,{ silent: true }).stdout;
      shell.exec(`sudo systemctl stop ${fluxdServiceName}`,{ silent: true });
      if (!isArcane) shell.exec("sudo fuser -k 16125/tcp",{ silent: true });
      shell.exec("sudo apt-get update",{ silent: true });
      shell.exec("sudo apt-get install flux -y",{ silent: true });
      var zelcash_dpkg_version_after = shell.exec(`dpkg -l flux | grep -w flux | awk '{print $3}'`,{ silent: true }).stdout;
      sleep.sleep(2);
      shell.exec(`sudo systemctl start ${fluxdServiceName}`,{ silent: true });
      if ( (zelcash_dpkg_version_before !== zelcash_dpkg_version_after) && zelcash_dpkg_version_after != "" ){
        await discord_hook(`Fluxnode daemon updated!\nVersion: **${zelcash_dpkg_version_after}**`,web_hook_url,ping,'Update','#1F8B4C','Info','watchdog_update1.png',label);
        // Update notification daemon
        var emoji_title = '\u{23F0}';
        var emoji_update='\u{1F504}';
        var info_type = 'New Update '+emoji_update;
        var field_type = 'Info: ';
        var msg_text = "Fluxnode Daemon updated! \n<b>Version: </b>"+zelcash_dpkg_version_after;
        await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
        console.log('Update successfully.');
        console.log(' ');
        sleep.sleep(2);
      } else {
        console.log('Script called.');
        console.log(' ');
        sleep.sleep(2);
      }
    }
  }
 }

if (config.zelbench_update == "1") {

 var zelbench_remote_version = shell.exec("curl -s -m 5 https://apt.runonflux.io/pool/main/f/fluxbench/ | grep -o '[0-9].[0-9].[0-9]' | head -n1",{ silent: true }).stdout;
 var zelbench_local_version = shell.exec("dpkg -l fluxbench | grep -w fluxbench | awk '{print $3}'",{ silent: true }).stdout;


 console.log(`Fluxbench current: ${zelbench_remote_version.trim()} installed: ${zelbench_local_version.trim()}`);

  if ( zelbench_remote_version.trim() != "" && zelbench_local_version.trim() != "" ){

    if ( zelbench_remote_version.trim() !== zelbench_local_version.trim() ){
     component_update = 1;
     console.log('New Fluxbench version detected:');
     console.log('=================================================================');
     console.log('Local version: '+zelbench_local_version.trim());
     console.log('Remote version: '+zelbench_remote_version.trim());
     console.log('=================================================================');

     var  update_info = shell.exec("ps -C apt,apt-get,dpkg >/dev/null && echo 'installing software' || echo 'all clear'",{ silent: true }).stdout;
     if ( update_info == "installing software" ) {

      shell.exec("sudo killall apt",{ silent: true }).stdout;
      shell.exec("sudo killall apt-get",{ silent: true }).stdout;
      shell.exec("sudo dpkg --configure -a",{ silent: true }).stdout;

     }


   var zelbench_dpkg_version_before = shell.exec(`dpkg -l fluxbench | grep -w fluxbench | awk '{print $3}'`,{ silent: true }).stdout;
   // For Arcane, we have to stop this as fluxd requires fluxbenchd, as it will
   // start it if it's not present. (We need to remove this from fluxd source code)
   shell.exec(`sudo systemctl stop ${fluxdServiceName}`,{ silent: true });
   if (isArcane) shell.exec("sudo systemctl stop fluxbenchd.service");
   if (!isArcane) shell.exec("sudo fuser -k 16125/tcp",{ silent: true });
   shell.exec("sudo apt-get update",{ silent: true });
   shell.exec("sudo apt-get install fluxbench -y",{ silent: true });
   sleep.sleep(2);
   if (isArcane) shell.exec("sudo systemctl start fluxbenchd.service");
   shell.exec(`sudo systemctl start ${fluxdServiceName}`,{ silent: true });

   var zelbench_dpkg_version_after = shell.exec(`dpkg -l fluxbench | grep -w fluxbench | awk '{print $3}'`,{ silent: true }).stdout;

     if ( (zelbench_dpkg_version_before !== zelbench_dpkg_version_after) && zelbench_dpkg_version_after != "" ){

       await discord_hook(`Fluxnode benchmark updated!\nVersion: **${zelbench_dpkg_version_after}**`,web_hook_url,ping,'Update','#1F8B4C','Info','watchdog_update1.png',label);

       // Update notification benchmark telegram
       var emoji_title = '\u{23F0}';
       var emoji_update='\u{1F504}';
       var info_type = 'New Update '+emoji_update;
       var field_type = 'Info: ';
       var msg_text = "Fluxnode Benchmark updated! \n</pre><b>Version: </b>"+zelbench_dpkg_version_after;
       await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

        console.log('Update successfully.');
        console.log(' ');
        sleep.sleep(2);
     } else {
        console.log('Script called.');
        console.log(' ');
        sleep.sleep(2);
     }


  }
 }
}
console.log('=================================================================');

}

async function flux_check() {
  const fluxbenchServiceName = isArcane
  ? "fluxbenchd.service"
  : "zelcash.service";

  const fluxOsRestartCmd = isArcane
    ? "sudo systemctl restart fluxos.service"
    : "pm2 restart flux";

  const fluxbenchLogPath = isArcane
    ? path.join(fluxbenchPath, 'debug.log')
    : '/home/$USER/.fluxbenchmark/debug.log';

  delete require.cache[require.resolve('./config.js')];
  var config=require('./config.js');
  web_hook_url=config.web_hook_url;
  action=config.action;
  ping=config.ping;
  label=config.label;

  const service_inactive = shell.exec(`systemctl list-units --full -all | grep ${fluxdServiceName} | grep -o inactive`,{ silent: true }).stdout;
  const data_time_utc = moment.utc().format('YYYY-MM-DD HH:mm:ss');
  const stillUtc = moment.utc(data_time_utc).toDate();
  const local = moment(stillUtc).local().format('YYYY-MM-DD HH:mm:ss');

  console.log('UTC: '+data_time_utc+' | LOCAL: '+local );
  console.log('=================================================================');

var  update_info = shell.exec("ps -C apt,apt-get,dpkg >/dev/null && echo 'installing software' || echo 'all clear'",{ silent: true }).stdout;
if ( update_info == "installing software" ) {
  console.log('Update detected...');
  console.log('Watchdog in sleep mode => '+data_time_utc);
  console.log('=================================================================');
  return;
}

if ( service_inactive.trim() == "inactive" ) {

  console.log('Flux daemon service status: inactive');
  console.log('Watchdog in sleep mode => '+data_time_utc);
  ++inactive_counter;
  console.log('============================================================['+inactive_counter+']');
  if ( inactive_counter > 6 ) {
    if (!isArcane) shell.exec("sudo fuser -k 16125/tcp",{ silent: true })
    shell.exec(`sudo systemctl start ${fluxdServiceName}`,{ silent: true })
    inactive_counter=0;
   } else {
   return;
  }
}

if ( component_update == 1 ) {
    console.log('Component update detected!');
    console.log('Watchdog checking skipped!');
    console.log('=================================================================');
    component_update = 0;
    return;
 }


if ( zelbench_counter > 2 || zelcashd_counter > 2 || zelbench_daemon_counter > 2 ){

  try{
    var zelcash_height = shell.exec(`${daemon_cli} getblockcount`,{ silent: true }).stdout;
    var zelbench_getstatus_info = JSON.parse(shell.exec(`${bench_cli} getstatus`,{ silent: true }).stdout);
    var zelbench_benchmark_status = zelbench_getstatus_info.benchmarking;
  } catch {

  }

   if (watchdog_sleep != "1"){

      watchdog_sleep="1";

     if ( zelcashd_counter > 2 ) {
       error('Watchdog in sleep mode! Flux daemon status: not responding');
      } else {
       error('Watchdog in sleep mode! Fluxbench status: '+zelbench_benchmark_status);
      }

   }

   if (typeof zelcash_height !== "undefined" && isNumber(zelcash_height) && zelbench_benchmark_status != "toaster" && zelbench_benchmark_status != "failed"  && typeof zelbench_benchmark_status !== "undefined"){
          zelcashd_counter=0;
          zelbench_counter=0;
          zelbench_daemon_counter=0;
          watchdog_sleep="N/A"
          sleep_msg=0;
   } else {
        console.log('Watchdog in sleep mode => '+data_time_utc);
        console.log('=================================================================');
        if  (  zelcashd_counter == 3  || zelbench_counter == 3 ) {

          if  ( sleep_msg == "0" ) {
            sleep_msg=1;
            await discord_hook("Watchdog in sleep mode..\nManual operation needed!",web_hook_url,ping,'Alert','#EA1414','Info','watchdog_manual1.png',label);
          // Watchdog in sleep mode notification telegram
            var emoji_title = '\u{1F6A8}';
            var emoji_bell = '\u{1F514}';
            var info_type = 'Alert '+emoji_bell;
            var field_type = 'Info: ';
            var msg_text = "<b>Watchdog in sleep mode!</b>\n----------------------------------------\n\u{203C} <b>Manual operation needed</b> \u{203C}";
            await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
          }

        }
        return;
   }
 }

try{

    var zelbench_getstatus_info = JSON.parse(shell.exec(`${bench_cli} getstatus`,{ silent: true }).stdout);
    var zelbench_status = zelbench_getstatus_info.status;
    var zelback_status = zelbench_getstatus_info.zelback;

    if ( typeof zelback_status  == "undefined" ){
      zelback_status = zelbench_getstatus_info.flux;
    }
    var zelbench_benchmark_status = zelbench_getstatus_info.benchmarking;

 }catch {

}

 try{
    var zelbench_getbenchmarks_info = JSON.parse(shell.exec(`${bench_cli} getbenchmarks`,{ silent: true }).stdout);
  //  var zelbench_ddwrite = zelbench_getbenchmarks_info.ddwrite;
    var zelbench_eps = zelbench_getbenchmarks_info.eps;
    var zelbench_time = zelbench_getbenchmarks_info.time;
    var zelbench_error = zelbench_getbenchmarks_info.error;
 }catch {

}

try{
  var  zelcash_height = shell.exec(`${daemon_cli} getblockcount`,{ silent: true }).stdout;
}catch {

}

 try{
    var zelcash_getzelnodestatus_info = JSON.parse(shell.exec(`${daemon_cli} getzelnodestatus`,{ silent: true }).stdout);
    var zelcash_node_status = zelcash_getzelnodestatus_info.status
    var zelcash_last_paid_height = zelcash_getzelnodestatus_info.last_paid_height
    var activesince = zelcash_getzelnodestatus_info.activesince
    var lastpaid = zelcash_getzelnodestatus_info.lastpaid
 }catch {

}

const mongod_check = shell.exec("pgrep mongod",{ silent: true }).stdout;

if ( typeof zelbench_status == "undefined" && typeof zelcash_height !== "undefined" && isNumber(zelcash_height) ) {

    ++zelbench_daemon_counter;

   if ( zelbench_daemon_counter == "1" ){

     console.log('Flux benchmark crash detected!');
     error('Flux benchmark crash detected!');
     await discord_hook("Flux benchmark crash detected!",web_hook_url,ping,'Alert','#EA1414','Error','watchdog_error1.png',label);

     // Daemon crash notification telegram
     var emoji_title = '\u{1F6A8}';
     var emoji_bell = '\u{1F514}';
     var info_type = 'Alert '+emoji_bell;
     var field_type = 'Error: ';
     var msg_text = 'Flux benchmark crash detected!';
     await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
     sleep.sleep(2);

   }

   if ( typeof action  == "undefined" || action == "1" ){
      shell.exec(`sudo systemctl stop ${fluxbenchServiceName}`,{ silent: true });
      sleep.sleep(2);
      if (!isArcane) shell.exec("sudo fuser -k 16125/tcp",{ silent: true });
      shell.exec(`sudo systemctl start ${fluxbenchServiceName}`,{ silent: true });
      console.log(data_time_utc+' => Flux benchmark restarting...');
      await discord_hook("Flux benchmark restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

      // Fix action daemon restarted notification telegram
      var emoji_title = '\u{26A1}';
      var emoji_fix = '\u{1F528}';
      var info_type = 'Fix Action '+emoji_fix;
      var field_type = 'Info: ';
      var msg_text = 'Flux benchmark restarted!';
      await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

   }

  console.log('=================================================================');
  return;

} else if ( zelbench_daemon_counter != 0  && ["CUMULUS", "NIMBUS", "STRATUS"].includes(zelbench_benchmark_status)) {

  await discord_hook("Flux benchmark fixed!",web_hook_url,ping,'Fix Info','#1F8B4C','Info','watchdog_fixed2.png',label);
  //Fixed benchmark notification telegram
  var emoji_title = '\u{1F4A1}';
  var emoji_fixed = '\u{2705}';
  var info_type = 'Fixed Info '+emoji_fixed;
  var field_type = 'Info: ';
  var msg_text = 'Flux benchmark fixed!';
  await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
  zelbench_daemon_counter=0;

}


if (zelcash_node_status == "" || typeof zelcash_node_status == "undefined" ){
   console.log('Fluxnode status = dead');
} else {
  if ( zelcash_node_status == "expired"){
    console.log('Fluxnode status = '+zelcash_node_status);

    if (expiried_time != "1"){
    expiried_time="1";
    error('Fluxnode expired => UTC: '+data_time_utc+' | LOCAL: '+local);
    await discord_hook('Fluxnode expired\nUTC: '+data_time_utc+'\nLOCAL: '+local,web_hook_url,ping,'Alert','#EA1414','Error','watchdog_error1.png',label);

    //Expired notification telegram
    var emoji_title = '\u{1F6A8}';
    var emoji_bell = '\u{1F514}';
    var info_type = 'Alert '+emoji_bell;
    var field_type = 'Error: ';
    var msg_text = "Fluxnode expired! \n<b>UTC: </b>"+data_time_utc+"\n<b>LOCAL: </b>"+local;
    await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

    }

   }
  else {
   expiried_time="N/A";
   console.log('Fluxnode status = '+zelcash_node_status);
   }
}

if (zelback_status == "" || typeof zelback_status == "undefined"){
  console.log('Fluxback status = dead');
} else {

  if (zelback_status == "disconnected"){
    ++disc_count;
    console.log('FluxOS status = '+zelback_status);
    if ( lock_zelback != "1" && disc_count == 2) {
    error('FluxOS disconnected!');
    var flux_api_port = shell.exec(`grep -w apiport ${fluxOsConfigPath} | grep -o '[[:digit:]]*'`,{ silent: true });
    var port_api = Number(flux_api_port.trim());
    var error_output=shell.exec(`curl -sSL -m 10 http://localhost:${port_api}/id/loginphrase`,{ silent: true }).stdout;
    error(`Error: ${error_output}`);
    await discord_hook("FluxOS disconnected!",web_hook_url,ping,'Alert','#EA1414','Error','watchdog_error1.png',label);

    // FluxOS disconnected notification telegram
    var emoji_title = '\u{1F6A8}';
    var emoji_bell = '\u{1F514}';
    var info_type = 'Alert '+emoji_bell;
    var field_type = 'Error: ';
    var msg_text = 'FluxOS disconnected!';
    await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

    sleep.sleep(2);
   lock_zelback=1;

    }

     if ( typeof action  == "undefined" || action == "1" ){

       if ( disc_count == 2 ){
        shell.exec(fluxOsRestartCmd,{ silent: true });
        shell.exec(`sudo systemctl restart ${fluxdServiceName}`,{ silent: true });
        sleep.sleep(2);
        console.log(data_time_utc+' => FluxOS restarting...');
        await discord_hook("FluxOS restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

        // Fix action telegram
        var emoji_title = '\u{26A1}';
        var emoji_fix = '\u{1F528}';
        var info_type = 'Fix Action '+emoji_fix;
        var field_type = 'Info: ';
        var msg_text = 'FluxOS restarted!';
        await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

       }

     }

  } else {
    console.log('FluxOS status = '+zelback_status);

    if (  disc_count == 2 ) {
      await discord_hook("FluxOS connection fixed!",web_hook_url,ping,'Fix Info','#1F8B4C','Info','watchdog_fixed2.png',label);

     // FluxOS fixed notification telegram
      var emoji_title = '\u{1F4A1}';
      var emoji_fixed = '\u{2705}';
      var info_type = 'Fixed Info '+emoji_fixed;
      var field_type = 'Info: ';
      var msg_text = 'FluxOS connection fixed!';
      await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

    }
    lock_zelback=0;
    disc_count=0;
  }
}

 if (zelbench_status == "" || typeof zelbench_status == "undefined"){
console.log('Fluxbench status = dead');
} else {

  if (zelbench_status  == "online"){
    console.log('Fluxbench status = '+zelbench_status);
  } else {
    console.log('Fluxbench status = '+zelbench_status);
  }

}

if (zelbench_benchmark_status == "" || typeof zelbench_benchmark_status == "undefined"){
  console.log('Fluxbench status = dead');
} else {

  if (zelbench_benchmark_status == "toaster" || zelbench_benchmark_status  == "failed" ){
    console.log('Benchmark status = '+zelbench_benchmark_status);
    await  discord_hook('Benchmark '+zelbench_benchmark_status+' \n**Reason:**\n'+zelbench_error,web_hook_url,ping,'Alert','#EA1414','Error','watchdog_error1.png',label);

    // Benchmark failed notification telegram
    var emoji_title = '\u{1F6A8}';
    var emoji_bell = '\u{1F514}';
    var info_type = 'Alert '+emoji_bell;
    var field_type = 'Error: ';
    var msg_text = "Benchmark "+zelbench_benchmark_status+" \u{274C} \n<b>Reason:</b>\n"+zelbench_error;
    await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);


  } else {
    console.log('Benchmark status = '+zelbench_benchmark_status);
  }
}

if (zelbench_time  == "null" || zelbench_time == "" || typeof zelbench_time == "undefined"){
} else{
  const durationInMinutes = '30';
  const timestamp = moment.unix(Number(zelbench_time));
  const bench_local_time = timestamp.format("DD/MM/YYYY HH:mm:ss")
  const next_benchmark_time = moment(timestamp, 'DD/MM/YYYY HH:mm:ss').add(durationInMinutes, 'minutes').format('DD/MM/YYYY HH:mm:ss');
  const start_date = moment(data_time_utc, 'YYYY-MM-DD HH:mm:ss');
  const end_date = moment(next_benchmark_time, 'YYYY-MM-DD HH:mm:ss');
  const time_left = moment(end_date.diff(start_date)).format("mm:ss");
  console.log('Last benchmark time = '+bench_local_time);
  console.log('Next benchmark time = '+next_benchmark_time+' (left: '+time_left+')');
}

if (zelcash_last_paid_height  == "null" || zelcash_last_paid_height == "" || typeof zelcash_last_paid_height == "undefined"){
} else{
  console.log('Last paid hight = '+zelcash_last_paid_height);
}

if (lastpaid == "null" || lastpaid == "" || typeof lastpaid == "undefined"){
console.log('Last paid time = '+paid_local_time);
} else{
  var timestamp_paid = moment.unix(Number(lastpaid));
  paid_local_time = timestamp_paid.format("DD/MM/YYYY HH:mm:ss")
  console.log('Last paid time = '+paid_local_time);
}

if (activesince  == "null" || activesince == "" || typeof activesince == "undefined"){
} else{
  const timestamp_active = moment.unix(Number(activesince));
  const active_local_time = timestamp_active.format("DD/MM/YYYY HH:mm:ss")
  console.log('Active since = '+active_local_time);
}

if (typeof zelcash_height !== "undefined" && isNumber(zelcash_height) ){

   if (  zelcashd_counter != 0 ) {

    await discord_hook("Flux daemon fixed!",web_hook_url,ping,'Fix Info','#1F8B4C','Info','watchdog_fixed2.png',label);

    // Daemon fixed notification telegram
    var emoji_title = '\u{1F4A1}';
    var emoji_fixed = '\u{2705}';
    var info_type = 'Fixed Info '+emoji_fixed;
    var field_type = 'Info: ';
    var msg_text = 'Flux daemon fixed!';
    await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

  }
  zelcashd_counter=0;
  console.log('Flux daemon status = running');
}
else {

  ++zelcashd_counter;
  console.log('Flux daemon status = dead');

   if ( zelcashd_counter == "1" ){

     error('Flux daemon crash detected!');
     await discord_hook("Flux daemon crash detected!",web_hook_url,ping,'Alert','#EA1414','Error','watchdog_error1.png',label);

     // Daemon crash notification telegram
     var emoji_title = '\u{1F6A8}';
     var emoji_bell = '\u{1F514}';
     var info_type = 'Alert '+emoji_bell;
     var field_type = 'Error: ';
     var msg_text = 'Flux daemon crash detected!';
     await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
     sleep.sleep(2);

   }

   if ( typeof action  == "undefined" || action == "1" ){
      shell.exec(`sudo systemctl stop ${fluxdServiceName}`,{ silent: true });
      sleep.sleep(2);
      if (!isArcane) shell.exec("sudo fuser -k 16125/tcp",{ silent: true });
      shell.exec(`sudo systemctl start ${fluxdServiceName}`,{ silent: true });
      console.log(data_time_utc+' => Flux daemon restarting...');
      await discord_hook("Flux daemon restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

      // Fix action daemon restarted notification telegram
      var emoji_title = '\u{26A1}';
      var emoji_fix = '\u{1F528}';
      var info_type = 'Fix Action '+emoji_fix;
      var field_type = 'Info: ';
      var msg_text = 'Flux daemon restarted!';
      await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

   }

}

if (mongod_check == ""){

  ++mongod_counter;
  console.log('MongoDB status = dead');

if ( mongod_counter == "1" ){
  error('MongoDB crash detected!');
  await discord_hook("MongoDB crash detected!",web_hook_url,ping,'Alert','#EA1414','Error','watchdog_error1.png',label);

  // MongoDB crash notification telegram
  var emoji_title = '\u{1F6A8}';
  var emoji_bell = '\u{1F514}';
  var info_type = 'Alert '+emoji_bell;
  var field_type = 'Error: ';
  var msg_text = 'MongoDB crash detected!';
  await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

 sleep.sleep(2);
}

  if (mongod_counter < 3){
      if ( typeof action  == "undefined" || action == "1" ){

          console.log(data_time_utc+' => MongoDB restarting...');
          shell.exec("sudo systemctl restart mongod",{ silent: true })
          await discord_hook("MongoDB restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

          // Fix action mongodb notification telegram
          var emoji_title = '\u{26A1}';
          var emoji_fix = '\u{1F528}';
          var info_type = 'Fix Action '+emoji_fix;
          var field_type = 'Info: ';
          var msg_text = 'MongoDB restarted!';
          await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

      }
  }

return;
} else {

 if (  mongod_counter != 0 ) {

  await discord_hook("MongoDB connection fixed!",web_hook_url,ping,'Fix Info','#1F8B4C','Info','watchdog_fixed2.png',label);

  // Fixed notification mongodb telegram
  var emoji_title = '\u{1F4A1}';
  var emoji_fixed = '\u{2705}';
  var info_type = 'Fixed Info '+emoji_fixed;
  var field_type = 'Info: ';
  var msg_text = 'MongoDB connection fixed!';
  await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

 }
  mongod_counter=0;
}

if ( zelbench_benchmark_status == "toaster" || zelbench_benchmark_status == "failed" ){
  ++zelbench_counter;
  var error_line=shell.exec(`egrep -a --color 'Failed' ${fluxbenchLogPath} | tail -1 | sed 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}.[0-9]\{2\}.[0-9]\{2\}.[0-9]\{2\}.//'`,{ silent: true });
  error('Benchmark problem detected! Fluxbench status: '+zelbench_benchmark_status);
  error('Reason: '+error_line.trim());
  console.log('Benchmark problem detected! Fluxbench status: '+zelbench_benchmark_status);
  console.log('Reason: '+error_line.trim());
  if ( typeof action  == "undefined" || action == "1" ){

    console.log(data_time_utc+' => Fluxbench restarting...');
    shell.exec(`${bench_cli} restartnodebenchmarks`,{ silent: true });
    await discord_hook("Benchmark restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

    // Fix action benchmark notification telegram
    var emoji_title = '\u{26A1}';
    var emoji_fix = '\u{1F528}';
    var info_type = 'Fix Action '+emoji_fix;
    var field_type = 'Info: ';
    var msg_text = 'Benchmark restarted!';
    await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
  }
}
else if ( zelbench_counter != 0 && ["CUMULUS", "NIMBUS", "STRATUS"].includes(zelbench_benchmark_status)) {
  await discord_hook("Flux benchmark fixed!",web_hook_url,ping,'Fix Info','#1F8B4C','Info','watchdog_fixed2.png',label);

  //Fixed benchmark notification telegram
  var emoji_title = '\u{1F4A1}';
  var emoji_fixed = '\u{2705}';
  var info_type = 'Fixed Info '+emoji_fixed;
  var field_type = 'Info: ';
  var msg_text = 'Flux benchmark fixed!';
  await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
  zelbench_counter=0;
}



delete require.cache[require.resolve('./config.js')];
var config = require('./config.js');

if (config.tier_eps_min != "" && config.tier_eps_min != "0" && zelbench_eps != "" && zelbench_eps < config.tier_eps_min ){
++tire_lock;
if ( tire_lock < 4 ) {
error('Benchmark problem detected! CPU eps under minimum limit for '+tire_name+'('+eps_limit+'), current eps: '+zelbench_eps.toFixed(2));
console.log('Benchmark problem detected!');
console.log('CPU eps under minimum limit for '+tire_name+'('+eps_limit+'), current eps: '+zelbench_eps.toFixed(2));
  if ( typeof action  == "undefined" || action == "1" ){

    console.log(data_time_utc+' => Fluxbench restarting...');
    shell.exec(`${bench_cli} restartnodebenchmarks`,{ silent: true });
    await discord_hook("Benchmark restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

    // Fix action benchmark notification telegram
    var emoji_title = '\u{26A1}';
    var emoji_fix = '\u{1F528}';
    var info_type = 'Fix Action '+emoji_fix;
    var field_type = 'Info: ';
    var msg_text = 'Benchmark restarted!';
    await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
  }
}

} else {
tire_lock=0;
}
 if ( zelcash_height != "" && typeof zelcash_height !== "undefined" && isNumber(zelcash_height) ){
   var skip_sync=between(1, 4);
   if ( skip_sync > 2 ) {
     await Check_Sync(zelcash_height,data_time_utc);
   } else {
    console.log('Sync check skipped: '+skip_sync+' <= 2');
   }
 }
console.log('============================================================['+zelbench_counter+'/'+zelcashd_counter+']');
}

async function saveHistoricValues() {
  const history = {
    arcaneVersionHistory,
    arcaneVersionHumanHistory,
  };

  try {
    await fsPromises.writeFile(historyFilePath, JSON.stringify(history, null, 2), 'utf-8');
    console.log('Saved historic values to history.json');
  } catch (error) {
    console.error('Failed to save history:', error.message);
  }
}

async function loadHistoricValues() {
  try {
    const content = await fsPromises.readFile(historyFilePath, 'utf-8');
    const history = JSON.parse(content);
    
    arcaneVersionHistory = history.arcaneVersionHistory || ''; 
    arcaneVersionHumanHistory = history.arcaneVersionHumanHistory || ''; 

    console.log('Successfully loaded historic values from history.json:');
    console.log(`FLUXOS_VERSION: ${arcaneVersionHistory}`);
    console.log(`FLUXOS_HUMAN_VERSION: ${arcaneVersionHumanHistory}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn('History file does not exist. Falling back to empty strings.');
      arcaneVersionHistory = ''; 
      arcaneVersionHumanHistory = '';
    } else {
      console.error('Error loading historic values:', error.message);
      arcaneVersionHistory = '';
      arcaneVersionHumanHistory = '';
    }
  }
}


async function parseEnvironmentFile(filePath) {
  try {
    const envContent = await fsPromises.readFile(filePath, 'utf-8');
    const variables = {};
    const lines = envContent.split('\n');
    lines.forEach((line) => {
      const match = line.match(/^(\w+)=["']?([^"']+)["']?$/);
      if (match) {
        const [, key, value] = match;
        variables[key] = value;
      }
    });
    return variables;
  } catch (error) {
    console.error(`Error reading or parsing environment file: ${error.message}`);
    return {};
  }
}

async function initializeHistoricValues() {
  const filePath = '/etc/environment';
  try {
    const variables = await parseEnvironmentFile(filePath);

    arcaneVersionHistory = variables.FLUXOS_VERSION || '';
    arcaneVersionHumanHistory = variables.FLUXOS_HUMAN_VERSION || '';

    console.log('Initialized values from /etc/environment:');
    console.log(`FLUXOS_VERSION: ${arcaneVersionHistory}`);
    console.log(`FLUXOS_HUMAN_VERSION: ${arcaneVersionHumanHistory}`);
    
  } catch (error) {
    console.error(`Failed to initialize historic values: ${error.message}`);
  }
}

async function arcaneUpdateDetection() {
  const filePath = '/etc/environment';
  try {
    const variables = await parseEnvironmentFile(filePath);
    const arcaneVersion = variables.FLUXOS_VERSION || '';
    const arcaneHumanVersion = variables.FLUXOS_HUMAN_VERSION || '';
    if (arcaneVersion && arcaneVersion !== arcaneVersionHistory) {
      console.log('New ArcaneOS version detected:');
      console.log('=================================================================');
      console.log('Local version: ' + arcaneVersionHistory.trim());
      console.log('Remote version: ' + arcaneVersion.trim());
      arcaneVersionHistory = arcaneVersion;
      arcaneVersionHumanHistory = arcaneHumanVersion;
      await saveHistoricValues();
      console.log('=================================================================');
      await discord_hook(`ArcaneOS updated!\nVersion: **${arcaneVersion} (${arcaneHumanVersion})**`, web_hook_url, ping, 'Update','#1F8B4C', 'Info', 'watchdog_update1.png', label);
      const emoji_title = '\u{23F0}';
      const emoji_update = '\u{1F504}';
      const info_type = 'New Update ' + emoji_update;
      const field_type = 'Info: ';
      const msg_text = `ArcaneOS updated!\n<b>Version: </b>${arcaneVersion} (${arcaneHumanVersion})`;
      await send_telegram_msg(emoji_title, info_type, field_type, msg_text, label);
    }
  } catch (error) {
    console.error(`Failed to parse environment file: ${error.message}`);
  }
}

async function checkArcane() {
  await loadHistoricValues();
  if (!arcaneVersionHistory) {
      await initializeHistoricValues();
      await saveHistoricValues();
  }
  await arcaneUpdateDetection();
}

function isNumber(n) { return !isNaN(parseFloat(n)) && !isNaN(n - 0) }

if (isArcane) {
  checkArcane().then(() => job_creator());
} else {
  job_creator();
}


