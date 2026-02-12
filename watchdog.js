const { version: packageVersion } = require('./package.json');

const { promisify } = require('util');
const { execFile } = require('child_process');
const os = require('os');
const moment = require('moment');
const webhook = require("@prince25/discord-webhook-sender");
const fs = require('fs');
const fsPromises = require('fs/promises');
const axios = require('axios');
const path = require('node:path');

const execFilePromise = promisify(execFile);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a command using child_process.execFile
 * @param {string} userCmd - Command to run
 * @param {object} options - Options object
 * @param {string[]} options.params - Array of parameters
 * @param {boolean} options.runAsRoot - Run with sudo
 * @param {boolean} options.logError - Log errors (default true)
 * @param {number} options.timeout - Timeout in ms (default 900000 = 15 min)
 * @param {string} options.cwd - Working directory
 * @param {object} options.env - Environment variables
 * @returns {Promise<{error: Error|null, stdout: string, stderr: string}>}
 */
async function runCommand(userCmd, options = {}) {
  const res = { error: null, stdout: '', stderr: '' };
  const {
    runAsRoot, logError = true, params = [], cwd, env, ...execOptions
  } = options;

  // Default max of 15 minutes
  if (!Object.prototype.hasOwnProperty.call(execOptions, 'timeout')) {
    execOptions.timeout = 900000;
  }

  if (!userCmd) {
    res.error = new Error('Command must be present');
    return res;
  }

  if (!Array.isArray(params) || !params.every((p) => typeof p === 'string' || typeof p === 'number')) {
    res.error = new Error('Invalid params for command, must be an Array of strings');
    return res;
  }

  let cmd;
  const cmdParams = [...params];
  if (runAsRoot) {
    cmdParams.unshift(userCmd);
    cmd = 'sudo';
  } else {
    cmd = userCmd;
  }

  if (cwd) execOptions.cwd = cwd;
  if (env) execOptions.env = { ...process.env, ...env };

  try {
    const { stdout, stderr } = await execFilePromise(cmd, cmdParams, execOptions);
    res.stdout = stdout || '';
    res.stderr = stderr || '';
  } catch (err) {
    res.error = err;
    res.stdout = err.stdout || '';
    res.stderr = err.stderr || '';
    if (logError) {
      console.error(`Command error: ${cmd} ${cmdParams.join(' ')}`);
      console.error(err.message);
    }
  }

  return res;
}

/**
 * Run a shell command (for commands with pipes, redirects, etc.)
 * @param {string} command - Shell command string
 * @param {object} options - Options
 * @param {number} options.timeout - Timeout in ms
 * @param {boolean} options.runAsRoot - Run with sudo
 * @returns {Promise<{error: Error|null, stdout: string, stderr: string}>}
 */
async function runShellCommand(command, options = {}) {
  const { timeout = 900000, runAsRoot = false } = options;

  const cmd = runAsRoot ? 'sudo' : 'sh';
  const params = runAsRoot ? ['-E', 'sh', '-c', command] : ['-c', command];

  return runCommand(cmd, { params, timeout, logError: false });
}

console.log(`Watchdog ${packageVersion} Starting...`);
console.log('=================================================================');

const configPath = 'config.js';

const isArcane = Boolean(process.env.FLUXOS_PATH);
const fluxdConfigPath = process.env.FLUXD_CONFIG_PATH;
const fluxbenchPath = process.env.FLUXBENCH_PATH;
const fluxOsRootDir = process.env.FLUXOS_PATH || path.join(os.homedir(), "zelflux");
const fluxOsConfigPath = path.join(fluxOsRootDir, "config/userconfig.js")
const fluxdServiceName = isArcane ? "fluxd.service" : "zelcash.service";
const historyFilePath = path.join(__dirname, 'history.json');

let arcaneVersionHistory = '';
let arcaneVersionHumanHistory = '';
let debounceTimeout;

let sync_lock = 0;
let tire_lock=0;
let lock_zelback=0;
let zelcashd_counter=0;
let zelbench_counter=0;
let zelbench_daemon_counter=0;
let inactive_counter=0;
let mongod_counter=0;
let paid_local_time="N/A";
let expiried_time="N/A";
let watchdog_sleep="N/A";
let disc_count = 0;
let h_IP=0;
let component_update=0;
let job_count=0;
let sleep_msg=0;
let last_failure_benchmark_time=0;

// Module-level variables for config - will be set during initialization
let daemon_cli;
let bench_cli;
let tire_name;
let config;
let eps_limit;
let web_hook_url;
let action;
let ping;
let telegram_alert;
let label;

// Module-level variables for flux_check - used across try/catch blocks
let zelcash_height;
let zelbench_getstatus_info;
let zelbench_benchmark_status;
let zelbench_status;
let zelback_status;
let zelbench_getbenchmarks_info;
let zelbench_eps;
let zelbench_time;
let zelbench_error;
let zelcash_getzelnodestatus_info;
let zelcash_node_status;
let zelcash_last_paid_height;
let activesince;
let lastpaid;

function between(min, max) {
  return Math.floor(
    Math.random() * (max - min) + min
  )
}

let autoUpdate = between(60, 240); // auto update will now be different on each node and checks are defined between 1 and 4h.
let cloudUIChecked = false;

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

async function checkCloudUI() {
  console.log('checkCloudUI: Starting CloudUI check...');
  const cloudUIDir = path.join(fluxOsRootDir, 'CloudUI');
  if (fs.existsSync(cloudUIDir)) {
    console.log('checkCloudUI: CloudUI directory already exists. Skipping.');
    return;
  }
  const fluxOsPkgFile = path.join(fluxOsRootDir, "package.json");
  const { stdout: zelflux_local_version } = await runShellCommand(`jq -r '.version' ${fluxOsPkgFile}`, { timeout: 5000 });
  const version = zelflux_local_version.trim();
  console.log(`checkCloudUI: FluxOS version detected: ${version || 'N/A'}`);
  if (version && compareVersions(version, '8.0.0') >= 0) {
    console.log(`checkCloudUI: FluxOS version ${version} >= 8.0.0. Downloading CloudUI...`);
    await runShellCommand(`cd ${fluxOsRootDir} && npm run update:cloudui`, { timeout: 120000 });
    console.log('checkCloudUI: CloudUI download completed.');
  } else {
    console.log('checkCloudUI: FluxOS version < 8.0.0 or not detected. Skipping CloudUI download.');
  }
}

async function job_creator(){
  try{
    if (!cloudUIChecked) {
      await checkCloudUI();
      cloudUIChecked = true;
    }
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
    await sleep(60 * 1_000);
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
  let MyIP = null;
  for (const [index, val] of check_list.entries()) {
    const { stdout } = await runShellCommand(`curl -sk -m 10 https://${val} | tr -dc '[:alnum:].'`, { timeout: 15000 });
    MyIP = stdout;

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
      const { stdout: api_port } = await runShellCommand(`grep -w apiport ${fluxOsConfigPath} | grep -o '[[:digit:]]*'`, { timeout: 5000 });
      let ui_port;
      if (api_port.trim() == "") {
        ui_port = 16126;
      } else {
        ui_port = Number(api_port.trim()) - 1;
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
    const args = Array.prototype.slice.call(arguments);
    return Math.max.apply(Math, args.filter(function(val) {
       return !isNaN(val);
    }));
}

async function Check_Sync(height,time) {
  // var exec_comment1=`curl -sk -m 8 https://explorer.flux.zelcore.io/api/status?q=getInfo | jq '.info.blocks'`
  const exec_comment2=`curl -sk -m 8 https://explorer.runonflux.io/api/status?q=getInfo | jq '.info.blocks'`;
  const exec_comment3=`curl -sk -m 8 https://explorer.zelcash.online/api/status?q=getInfo | jq '.info.blocks'`;
 // var explorer_block_height_01 = await runShellCommand(`${exec_comment1}`, { timeout: 10000 }).stdout;
  const { stdout: explorer_block_height_02 } = await runShellCommand(`${exec_comment2}`, { timeout: 10000 });
  const { stdout: explorer_block_height_03 } = await runShellCommand(`${exec_comment3}`, { timeout: 10000 });
  const explorer_block_height = max(explorer_block_height_02,explorer_block_height_03);
  const height_diff = Math.abs(explorer_block_height-height);

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
           const emoji_title = '\u{1F4A1}';
           const emoji_fixed = '\u{2705}';
           const info_type = 'Fixed Info '+emoji_fixed;
           const field_type = 'Info: ';
           const msg_text = 'Flux daemon is synced!';
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
       const emoji_title = '\u{1F6A8}';
       const emoji_bell = '\u{1F514}';
       const info_type = 'Alert '+emoji_bell;
       const field_type = 'Error: ';
       const msg_text = "Flux daemon is not synced! \n<b>Daemon height: </b>"+height+"\n<b>Network height: </b>"+explorer_block_height+"\n<b>Diff: </b>"+height_diff;
       await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);



       if ( typeof action  == "undefined" || action == "1" ){


         await runCommand('systemctl', { params: ['stop', fluxdServiceName], runAsRoot: true, timeout: 30000 });
         await sleep(2 * 1_000);
         if (!isArcane) await runCommand('fuser', { params: ['-k', '16125/tcp'], runAsRoot: true, timeout: 5000 });
         await runCommand('systemctl', { params: ['start', fluxdServiceName], runAsRoot: true, timeout: 30000 });
         console.log(time+' => Flux daemon restarting...');
         await discord_hook("Flux daemon restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

         // Fix action telegram
         const emoji_title = '\u{26A1}';
         const emoji_fix = '\u{1F528}';
         const info_type = 'Fix Action '+emoji_fix;
         const field_type = 'Info: ';
         const msg_text = 'Flux daemon restarted!';
         await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

       }

      sync_lock = 1;
    }

  }
}

async function initializeConfig() {
  if (fs.existsSync(configPath)) {
    const home_dir = os.homedir();
    let daemonConfigPath = `${home_dir}/.zelcash/zelcash.conf`;
    daemon_cli='zelcash-cli';

    if (fs.existsSync(`/usr/local/bin/flux-cli`)) {
       daemon_cli = isArcane
         ? `flux-cli -conf=${fluxdConfigPath}`
         : "flux-cli";
    }

    if (!fs.existsSync(daemonConfigPath)) {
      daemonConfigPath = fluxdConfigPath || `${home_dir}/.flux/flux.conf`;
     }


    if (fs.existsSync(`/usr/local/bin/fluxbenchd`)) {
       bench_cli='fluxbench-cli';
     } else {
       bench_cli='zelbench-cli';
     }


    if (fs.existsSync(daemonConfigPath)) {
      const { stdout: tx_hash } = await runShellCommand(`grep -w zelnodeoutpoint "${daemonConfigPath}" | sed -e 's/zelnodeoutpoint=//'`, { timeout: 5000 });
      const exec_comment = `${daemon_cli} decoderawtransaction $(${daemon_cli} getrawtransaction ${tx_hash.trim()} ) | jq '.vout[].value' | egrep '1000|12500|40000'`;
      const { stdout: type } = await runShellCommand(exec_comment, { timeout: 30000 });
      switch(Number(type.trim())){
        case 1000:
        tire_name="CUMULUS";
        break;

        case 12500:
        tire_name="NIMBUS";
        break;

        case 40000:
        tire_name="STRATUS";
        break;

        default:
        tire_name="UNKNOW";
      }

  } else {

      tire_name="UNKNOW";
    }


  config = require('./config.js');
  eps_limit=config.tier_eps_min;
  web_hook_url=config.web_hook_url;
  action=config.action;
  ping=config.ping;
  telegram_alert = config.telegram_alert;
  label= config.label;

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


  if (isArcane) {
    console.log(`Update settings (config-dependent for ArcaneOS):`);
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
  } else {
    console.log(`Update settings (always enabled for non-Arcane):`);
    console.log('=> Flux daemon:  enabled');
    console.log('=> Fluxbench: enabled');
    console.log('=> FluxOS:  enabled');
  }
  console.log('=================================================================');
  }
  else {
    const home_dir = os.homedir();
    let daemonConfigPath = `${home_dir}/.zelcash/zelcash.conf`;
    daemon_cli='zelcash-cli';
    bench_cli='zelbench-cli';

    if (fs.existsSync(`/usr/local/bin/flux-cli`)) {
      daemon_cli = isArcane
      ? `flux-cli -conf=${fluxdConfigPath}`
      : "flux-cli";
    }

    if (!fs.existsSync(daemonConfigPath)) {
      daemonConfigPath = isArcane
         ? fluxdConfigPath
         : `${home_dir}/.flux/flux.conf`;
     }


    if (fs.existsSync(`/usr/local/bin/fluxbenchd`)) {
       bench_cli='fluxbench-cli';
    }

    if (fs.existsSync(daemonConfigPath)) {
     const { stdout: tx_hash } = await runShellCommand(`grep -w zelnodeoutpoint "${daemonConfigPath}" | sed -e 's/zelnodeoutpoint=//'`, { timeout: 5000 });
     const exec_comment = `${daemon_cli} decoderawtransaction $(${daemon_cli} getrawtransaction ${tx_hash.trim()} ) | jq '.vout[].value' | egrep '1000|12500|40000'`;
     const { stdout: type } = await runShellCommand(`${exec_comment}`, { timeout: 30000 });

     switch(Number(type.trim())){
         case 1000:
         tire_name="CUMULUS";
         eps_limit = 90;
         break;

         case 12500:
         tire_name="NIMBUS";
         eps_limit = 180
         break;

         case 40000:
         tire_name="STRATUS";
         eps_limit = 300
         break;

         default:
         tire_name="UNKNOW";
         eps_limit = 0;

    }

  } else {
      eps_limit = 0;
      tire_name="UNKNOW";
  }


  const dataToWrite = `module.exports = {
    tier_eps_min: '${eps_limit}',
    zelflux_update: '0',
    zelcash_update: '0',
    zelbench_update: '0',
    action: '1',
    ping: '0',
    web_hook_url: '0',
    telegram_alert: '0',
    telegram_bot_token: '0',
    telegram_chat_id: '0'
  }`;

  console.log('Creating config file...');
  console.log("========================");

  fs.writeFile(configPath, dataToWrite);

  config = require('./config.js');
  web_hook_url=config.web_hook_url;
  action=config.action;
  ping=config.ping;
  telegram_alert = config.telegram_alert;

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

  if (isArcane) {
    console.log(`Update settings (config-dependent for ArcaneOS):`);
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
  } else {
    console.log(`Update settings (always enabled for non-Arcane):`);
    console.log('=> Flux daemon:  enabled');
    console.log('=> Fluxbench: enabled');
    console.log('=> FluxOS:  enabled');
  }
  console.log('=================================================================');

  }
}

async function send_telegram_msg(emoji_title, info_type, field_type, msg_text, label) {
  const telegram_alert = config.telegram_alert;

  if (typeof telegram_alert !== "undefined" && telegram_alert == 1) {
    try {
      const node_ip = await Myip();
      const { stdout: api_port } = await runShellCommand(`grep -w apiport ${fluxOsConfigPath} | grep -o '[[:digit:]]*'`, { timeout: 5000 });
      let ui_port;
      if (api_port.trim() == "") {
        ui_port = 16126;
      } else {
        ui_port = Number(api_port.trim()) - 1;
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

  const fluxWatchdogRestartCmd = isArcane
    ? "systemctl restart flux-watchdog"
    : "pm2 restart watchdog --watch";

  const fluxOsInstallCmd = isArcane
    // just use a dummy command here for non arcane
    ? `cd ${fluxOsRootDir} && npm install --omit=dev --cache /dat/usr/lib/npm`
    : ":";

  const fluxOsPkgFile = path.join(fluxOsRootDir, "package.json");

  delete require.cache[require.resolve('./config.js')];
  config = require('./config.js');
  const { stdout: remote_version } = await runShellCommand("curl -sS -m 5 https://raw.githubusercontent.com/RunOnFlux/fluxnode-watchdog/master/package.json | jq -r '.version'", { timeout: 10000 });
  const { stdout: local_version } = await runShellCommand("jq -r '.version' package.json", { timeout: 5000 });
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
      await runShellCommand(`cd ${watchdogPath} && git checkout . && git fetch && git pull -p`, { timeout: 60000 });
      const { stdout: local_ver } = await runShellCommand("jq -r '.version' package.json", { timeout: 5000 });
      if ( local_ver.trim() == remote_version.trim() ){
        await discord_hook(`Fluxnode Watchdog updated!\nVersion: **${remote_version}**`,web_hook_url,ping,'Update','#1F8B4C','Info','watchdog_update1.png',label);

        // Update notification Watchdog telegram
       const emoji_title = '\u{23F0}';
        const emoji_update='\u{1F504}';
        const info_type = 'New Update '+emoji_update;
        const field_type = 'Info: ';
        const msg_text = "Fluxnode Watchdog updated! \n<b>Version: </b>"+remote_version;
        await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

        console.log('Update successfully.');
        if (isArcane) await sleep(5 * 1_000);
        await runShellCommand(fluxWatchdogRestartCmd, { timeout: 30000 });
      }
      await sleep(20 * 1_000);
      console.log(' ');
    }
  }
  // FluxOS auto-update (always enabled for non-Arcane, config-dependent for Arcane)
  if (!isArcane || config.zelflux_update == "1") {
   const { stdout: zelflux_remote_version } = await runShellCommand("curl -sS -m 5 https://raw.githubusercontent.com/RunOnFlux/flux/master/package.json | jq -r '.version'", { timeout: 10000 });
   const { stdout: zelflux_local_version } = await runShellCommand(`jq -r '.version' ${fluxOsPkgFile}`, { timeout: 5000 });

   console.log(`FluxOS current: ${zelflux_remote_version.trim()} installed: ${zelflux_local_version.trim()}`);
   if ( zelflux_remote_version.trim() != "" && zelflux_local_version.trim() != "" ){

     if ( zelflux_remote_version.trim() !== zelflux_local_version.trim() ){
       component_update = 1;
       console.log('New FluxOS version detected:');
       console.log('=================================================================');
       console.log('Local version: '+zelflux_local_version.trim());
       console.log('Remote version: '+zelflux_remote_version.trim());
       console.log('=================================================================');
       await runShellCommand(fluxOsStopCmd, { timeout: 30000 });
       await sleep(5 * 1_000);
       await runShellCommand(`cd ${fluxOsRootDir} && git checkout . && git fetch && git pull -p`, { timeout: 60000 });
       await sleep(5 * 1_000);
       await runShellCommand(fluxOsInstallCmd, { timeout: 300000 });
       if (isArcane) await sleep(5 * 1_000);
       await runShellCommand(fluxOsStartCmd, { timeout: 30000 });
       await sleep(20);
       let zelflux_lv = (await runShellCommand(`jq -r '.version' ${fluxOsPkgFile}`, { timeout: 30000 })).stdout;
       if ( zelflux_remote_version.trim() == zelflux_lv.trim() ) {

         await discord_hook(`FluxOS Gravity updated!\nVersion: **${zelflux_remote_version}**`,web_hook_url,ping,'Update','#1F8B4C','Info','watchdog_update1.png',label);

         // Update notification FluxOS telegram
         const emoji_title = '\u{23F0}';
         const emoji_update='\u{1F504}';
         const info_type = 'New Update '+emoji_update;
         const field_type = 'Info: ';
         const msg_text = "FluxOS Gravity updated!\n<b>Version: </b>"+zelflux_remote_version;
         await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

         console.log('Update successfully.');
        }
       await sleep(20 * 1_000);
       console.log(' ');
    }
   }
  }
  await checkCloudUI();
  // FluxCloud UI version check (only if CloudUI is installed)
  const cloudui_dir = path.join(fluxOsRootDir, 'CloudUI');
  const cloudui_local_version_file = path.join(cloudui_dir, 'version');
  if (fs.existsSync(cloudui_dir) && fs.existsSync(cloudui_local_version_file)) {
    let cloudui_release_info = (await runShellCommand("curl -sS -m 10 https://api.github.com/repos/RunOnFlux/fluxos-frontend/releases/latest", { timeout: 30000 })).stdout;
    let cloudui_remote_hash = "";
    let cloudui_remote_tag = "";
    let cloudui_is_master = false;
    try {
      const cloudui_release = JSON.parse(cloudui_release_info);
      cloudui_is_master = cloudui_release.target_commitish === "master";
      cloudui_remote_tag = cloudui_release.tag_name || "";
      if (cloudui_is_master && cloudui_release.assets && cloudui_release.assets.length > 0) {
        const dist_asset = cloudui_release.assets.find(a => a.name === "dist.tar.gz");
        if (dist_asset && dist_asset.digest) {
          cloudui_remote_hash = dist_asset.digest.replace("sha256:", "");
        }
      }
    } catch (e) {
      console.log('FluxCloud UI: Failed to parse release info');
    }

    const cloudui_local_hash = fs.readFileSync(cloudui_local_version_file, 'utf8').trim();

    console.log(`FluxCloud UI current: ${cloudui_remote_tag} (${cloudui_remote_hash.substring(0,8) || 'N/A'}) installed: ${cloudui_local_hash.substring(0,8) || 'N/A'}`);
    if (cloudui_is_master && cloudui_remote_hash != "" && cloudui_remote_hash !== cloudui_local_hash) {
      component_update = 1;
      console.log('New FluxCloud UI version detected:');
      console.log('=================================================================');
      console.log('Local hash: '+(cloudui_local_hash || 'N/A'));
      console.log('Remote hash: '+cloudui_remote_hash);
      console.log('Remote tag: '+cloudui_remote_tag);
      console.log('=================================================================');
      (await runShellCommand(`cd ${fluxOsRootDir} && npm run update:cloudui`, { timeout: 30000 })).stdout;
      await sleep(5 * 1_000);
      let cloudui_lv = "";
      if (fs.existsSync(cloudui_local_version_file)) {
        cloudui_lv = fs.readFileSync(cloudui_local_version_file, 'utf8').trim();
      }
      if (cloudui_remote_hash == cloudui_lv) {
        await discord_hook(`FluxCloud UI updated!\nVersion: **${cloudui_remote_tag}**`,web_hook_url,ping,'Update','#1F8B4C','Info','watchdog_update1.png',label);

        // Update notification FluxCloud UI telegram
        const emoji_title = '\u{23F0}';
        const emoji_update='\u{1F504}';
        const info_type = 'New Update '+emoji_update;
        const field_type = 'Info: ';
        const msg_text = "FluxCloud UI updated!\n<b>Version: </b>"+cloudui_remote_tag;
        await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

        console.log('Update successfully.');
      }
      await sleep(20 * 1_000);
      console.log(' ');
    }
  }
  // Flux daemon auto-update (always enabled for non-Arcane, config-dependent for Arcane)
  if (!isArcane || config.zelcash_update == "1") {
    let zelcash_remote_version = (await runShellCommand("curl -s -m 5 https://apt.runonflux.io/pool/main/f/flux/ | grep -o '[0-9].[0-9].[0-9]' | head -n1", { timeout: 30000 })).stdout;
    let zelcash_local_version = (await runShellCommand(`dpkg -l flux | grep -w flux | awk '{print $3}'`, { timeout: 30000 })).stdout;
    console.log(`Flux daemon current: ${zelcash_remote_version.trim()} installed: ${zelcash_local_version.trim()}`);
    if ( zelcash_remote_version.trim() != "" && zelcash_local_version.trim() != "" ){
      if ( zelcash_remote_version.trim() !== zelcash_local_version.trim() ){
      component_update = 1;
      console.log('New Flux daemon version detected:');
      console.log('=================================================================');
      console.log('Local version: '+zelcash_local_version.trim());
      console.log('Remote version: '+zelcash_remote_version.trim());
      let update_info = (await runShellCommand("ps -C apt,apt-get,dpkg >/dev/null && echo 'installing software' || echo 'all clear'", { timeout: 30000 })).stdout;
      if ( update_info == "installing software" ) {

        (await runShellCommand("sudo killall apt", { timeout: 30000 })).stdout;
        (await runShellCommand("sudo killall apt-get", { timeout: 30000 })).stdout;
        (await runShellCommand("sudo dpkg --configure -a", { timeout: 30000 })).stdout;

      }
      let zelcash_dpkg_version_before = (await runShellCommand(`dpkg -l flux | grep -w flux | awk '{print $3}'`, { timeout: 30000 })).stdout;
      await runShellCommand(`sudo systemctl stop ${fluxdServiceName}`, { timeout: 30000 });
      if (!isArcane) await runShellCommand("sudo fuser -k 16125/tcp", { timeout: 30000 });
      await runShellCommand("sudo apt-get update", { timeout: 30000 });
      await runShellCommand("sudo apt-get install flux -y", { timeout: 30000 });
      let zelcash_dpkg_version_after = (await runShellCommand(`dpkg -l flux | grep -w flux | awk '{print $3}'`, { timeout: 30000 })).stdout;
      await sleep(2 * 1_000);
      await runShellCommand(`sudo systemctl start ${fluxdServiceName}`, { timeout: 30000 });
      if ( (zelcash_dpkg_version_before !== zelcash_dpkg_version_after) && zelcash_dpkg_version_after != "" ){
        await discord_hook(`Fluxnode daemon updated!\nVersion: **${zelcash_dpkg_version_after}**`,web_hook_url,ping,'Update','#1F8B4C','Info','watchdog_update1.png',label);
        // Update notification daemon
        const emoji_title = '\u{23F0}';
        const emoji_update='\u{1F504}';
        const info_type = 'New Update '+emoji_update;
        const field_type = 'Info: ';
        const msg_text = "Fluxnode Daemon updated! \n<b>Version: </b>"+zelcash_dpkg_version_after;
        await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
        console.log('Update successfully.');
        console.log(' ');
        await sleep(2 * 1_000);
      } else {
        console.log('Script called.');
        console.log(' ');
        await sleep(2 * 1_000);
      }
    }
  }
 }

// Fluxbench auto-update (always enabled for non-Arcane, config-dependent for Arcane)
if (!isArcane || config.zelbench_update == "1") {
 let zelbench_remote_version = (await runShellCommand("curl -s -m 5 https://apt.runonflux.io/pool/main/f/fluxbench/ | grep -o '[0-9].[0-9].[0-9]' | head -n1", { timeout: 30000 })).stdout;
 let zelbench_local_version = (await runShellCommand("dpkg -l fluxbench | grep -w fluxbench | awk '{print $3}'", { timeout: 30000 })).stdout;


 console.log(`Fluxbench current: ${zelbench_remote_version.trim()} installed: ${zelbench_local_version.trim()}`);

  if ( zelbench_remote_version.trim() != "" && zelbench_local_version.trim() != "" ){

    if ( zelbench_remote_version.trim() !== zelbench_local_version.trim() ){
     component_update = 1;
     console.log('New Fluxbench version detected:');
     console.log('=================================================================');
     console.log('Local version: '+zelbench_local_version.trim());
     console.log('Remote version: '+zelbench_remote_version.trim());
     console.log('=================================================================');

     let update_info = (await runShellCommand("ps -C apt,apt-get,dpkg >/dev/null && echo 'installing software' || echo 'all clear'", { timeout: 30000 })).stdout;
     if ( update_info == "installing software" ) {

      (await runShellCommand("sudo killall apt", { timeout: 30000 })).stdout;
      (await runShellCommand("sudo killall apt-get", { timeout: 30000 })).stdout;
      (await runShellCommand("sudo dpkg --configure -a", { timeout: 30000 })).stdout;

     }


   let zelbench_dpkg_version_before = (await runShellCommand(`dpkg -l fluxbench | grep -w fluxbench | awk '{print $3}'`, { timeout: 30000 })).stdout;
   // For Arcane, we have to stop this as fluxd requires fluxbenchd, as it will
   // start it if it's not present. (We need to remove this from fluxd source code)
   await runCommand('systemctl', { params: ['stop', fluxdServiceName], runAsRoot: true, timeout: 30000 });
   if (isArcane) await runCommand('systemctl', { params: ['stop', 'fluxbenchd.service'], runAsRoot: true, timeout: 30000 });
   if (!isArcane) await runCommand('fuser', { params: ['-k', '16125/tcp'], runAsRoot: true, timeout: 5000 });
   await runCommand('apt-get', { params: ['update'], runAsRoot: true, timeout: 120000 });
   await runCommand('apt-get', { params: ['install', 'fluxbench', '-y'], runAsRoot: true, timeout: 300000 });
   await sleep(2 * 1_000);
   if (isArcane) await runCommand('systemctl', { params: ['start', 'fluxbenchd.service'], runAsRoot: true, timeout: 30000 });
   await runCommand('systemctl', { params: ['start', fluxdServiceName], runAsRoot: true, timeout: 30000 });

   let zelbench_dpkg_version_after = (await runShellCommand(`dpkg -l fluxbench | grep -w fluxbench | awk '{print $3}'`, { timeout: 30000 })).stdout;

     if ( (zelbench_dpkg_version_before !== zelbench_dpkg_version_after) && zelbench_dpkg_version_after != "" ){

       await discord_hook(`Fluxnode benchmark updated!\nVersion: **${zelbench_dpkg_version_after}**`,web_hook_url,ping,'Update','#1F8B4C','Info','watchdog_update1.png',label);

       // Update notification benchmark telegram
       const emoji_title = '\u{23F0}';
       const emoji_update='\u{1F504}';
       const info_type = 'New Update '+emoji_update;
       const field_type = 'Info: ';
       const msg_text = "Fluxnode Benchmark updated! \n</pre><b>Version: </b>"+zelbench_dpkg_version_after;
       await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

        console.log('Update successfully.');
        console.log(' ');
        await sleep(2 * 1_000);
     } else {
        console.log('Script called.');
        console.log(' ');
        await sleep(2 * 1_000);
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
  const config=require('./config.js');
  web_hook_url=config.web_hook_url;
  action=config.action;
  ping=config.ping;
  label=config.label;

  const service_inactive = (await runShellCommand(`systemctl list-units --full -all | grep ${fluxdServiceName} | grep -o inactive`, { timeout: 30000 })).stdout;
  const data_time_utc = moment.utc().format('YYYY-MM-DD HH:mm:ss');
  const stillUtc = moment.utc(data_time_utc).toDate();
  const local = moment(stillUtc).local().format('YYYY-MM-DD HH:mm:ss');

  console.log('UTC: '+data_time_utc+' | LOCAL: '+local );
  console.log('=================================================================');

let update_info = (await runShellCommand("ps -C apt,apt-get,dpkg >/dev/null && echo 'installing software' || echo 'all clear'", { timeout: 30000 })).stdout;
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
    if (!isArcane) await runShellCommand("sudo fuser -k 16125/tcp", { timeout: 30000 });
    await runShellCommand(`sudo systemctl start ${fluxdServiceName}`, { timeout: 30000 });
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
    zelcash_height = (await runShellCommand(`${daemon_cli} getblockcount`, { timeout: 30000 })).stdout;
    zelbench_getstatus_info = JSON.parse((await runShellCommand(`${bench_cli} getstatus`, { timeout: 30000 })).stdout);
    zelbench_benchmark_status = zelbench_getstatus_info.benchmarking;
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
          last_failure_benchmark_time=0;
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
            const emoji_title = '\u{1F6A8}';
            const emoji_bell = '\u{1F514}';
            const info_type = 'Alert '+emoji_bell;
            const field_type = 'Info: ';
            const msg_text = "<b>Watchdog in sleep mode!</b>\n----------------------------------------\n\u{203C} <b>Manual operation needed</b> \u{203C}";
            await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
          }

        }
        return;
   }
 }

try{

    zelbench_getstatus_info = JSON.parse((await runShellCommand(`${bench_cli} getstatus`, { timeout: 30000 })).stdout);
    zelbench_status = zelbench_getstatus_info.status;
    zelback_status = zelbench_getstatus_info.zelback;

    if ( typeof zelback_status  == "undefined" ){
      zelback_status = zelbench_getstatus_info.flux;
    }
    zelbench_benchmark_status = zelbench_getstatus_info.benchmarking;

 }catch {

}

 try{
    zelbench_getbenchmarks_info = JSON.parse((await runShellCommand(`${bench_cli} getbenchmarks`, { timeout: 30000 })).stdout);
  //  var zelbench_ddwrite = zelbench_getbenchmarks_info.ddwrite;
    zelbench_eps = zelbench_getbenchmarks_info.eps;
    zelbench_time = zelbench_getbenchmarks_info.time;
    zelbench_error = zelbench_getbenchmarks_info.error;
 }catch {

}

try{
  zelcash_height = (await runShellCommand(`${daemon_cli} getblockcount`, { timeout: 30000 })).stdout;
}catch {

}

 try{
    zelcash_getzelnodestatus_info = JSON.parse((await runShellCommand(`${daemon_cli} getzelnodestatus`, { timeout: 30000 })).stdout);
    zelcash_node_status = zelcash_getzelnodestatus_info.status
    zelcash_last_paid_height = zelcash_getzelnodestatus_info.last_paid_height
    activesince = zelcash_getzelnodestatus_info.activesince
    lastpaid = zelcash_getzelnodestatus_info.lastpaid
 }catch {

}

const mongod_check = (await runShellCommand("pgrep mongod", { timeout: 30000 })).stdout;

if ( typeof zelbench_status == "undefined" && typeof zelcash_height !== "undefined" && isNumber(zelcash_height) ) {

    ++zelbench_daemon_counter;

   if ( zelbench_daemon_counter == "1" ){

     console.log('Flux benchmark crash detected!');
     error('Flux benchmark crash detected!');
     await discord_hook("Flux benchmark crash detected!",web_hook_url,ping,'Alert','#EA1414','Error','watchdog_error1.png',label);

     // Daemon crash notification telegram
     const emoji_title = '\u{1F6A8}';
     const emoji_bell = '\u{1F514}';
     const info_type = 'Alert '+emoji_bell;
     const field_type = 'Error: ';
     const msg_text = 'Flux benchmark crash detected!';
     await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
     await sleep(2 * 1_000);

   }

   if ( typeof action  == "undefined" || action == "1" ){
      await runShellCommand(`sudo systemctl stop ${fluxbenchServiceName}`, { timeout: 30000 });
      await sleep(2 * 1_000);
      if (!isArcane) await runShellCommand("sudo fuser -k 16125/tcp", { timeout: 30000 });
      await runShellCommand(`sudo systemctl start ${fluxbenchServiceName}`, { timeout: 30000 });
      console.log(data_time_utc+' => Flux benchmark restarting...');
      await discord_hook("Flux benchmark restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

      // Fix action daemon restarted notification telegram
      const emoji_title = '\u{26A1}';
      const emoji_fix = '\u{1F528}';
      const info_type = 'Fix Action '+emoji_fix;
      const field_type = 'Info: ';
      const msg_text = 'Flux benchmark restarted!';
      await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

   }

  console.log('=================================================================');
  return;

} else if ( zelbench_daemon_counter != 0  && ["CUMULUS", "NIMBUS", "STRATUS"].includes(zelbench_benchmark_status)) {

  await discord_hook("Flux benchmark fixed!",web_hook_url,ping,'Fix Info','#1F8B4C','Info','watchdog_fixed2.png',label);
  //Fixed benchmark notification telegram
  const emoji_title = '\u{1F4A1}';
  const emoji_fixed = '\u{2705}';
  const info_type = 'Fixed Info '+emoji_fixed;
  const field_type = 'Info: ';
  const msg_text = 'Flux benchmark fixed!';
  await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
  zelbench_daemon_counter=0;
  last_failure_benchmark_time=0;

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
    const emoji_title = '\u{1F6A8}';
    const emoji_bell = '\u{1F514}';
    const info_type = 'Alert '+emoji_bell;
    const field_type = 'Error: ';
    const msg_text = "Fluxnode expired! \n<b>UTC: </b>"+data_time_utc+"\n<b>LOCAL: </b>"+local;
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
    const { stdout: flux_api_port } = await runShellCommand(`grep -w apiport ${fluxOsConfigPath} | grep -o '[[:digit:]]*'`, { timeout: 5000 });
    const port_api = Number(flux_api_port.trim());
    const { stdout: error_output } = await runShellCommand(`curl -sSL -m 10 http://localhost:${port_api}/id/loginphrase`, { timeout: 15000 });
    error(`Error: ${error_output}`);
    await discord_hook("FluxOS disconnected!",web_hook_url,ping,'Alert','#EA1414','Error','watchdog_error1.png',label);

    // FluxOS disconnected notification telegram
    const emoji_title = '\u{1F6A8}';
    const emoji_bell = '\u{1F514}';
    const info_type = 'Alert '+emoji_bell;
    const field_type = 'Error: ';
    const msg_text = 'FluxOS disconnected!';
    await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

    await sleep(2 * 1_000);
   lock_zelback=1;

    }

     if ( typeof action  == "undefined" || action == "1" ){

       if ( disc_count == 2 ){
        await runShellCommand(fluxOsRestartCmd, { timeout: 30000 });
        await runCommand('systemctl', { params: ['restart', fluxdServiceName], runAsRoot: true, timeout: 30000 });
        await sleep(2 * 1_000);
        console.log(data_time_utc+' => FluxOS restarting...');
        await discord_hook("FluxOS restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

        // Fix action telegram
        const emoji_title = '\u{26A1}';
        const emoji_fix = '\u{1F528}';
        const info_type = 'Fix Action '+emoji_fix;
        const field_type = 'Info: ';
        const msg_text = 'FluxOS restarted!';
        await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

       }

     }

  } else {
    console.log('FluxOS status = '+zelback_status);

    if (  disc_count == 2 ) {
      await discord_hook("FluxOS connection fixed!",web_hook_url,ping,'Fix Info','#1F8B4C','Info','watchdog_fixed2.png',label);

     // FluxOS fixed notification telegram
      const emoji_title = '\u{1F4A1}';
      const emoji_fixed = '\u{2705}';
      const info_type = 'Fixed Info '+emoji_fixed;
      const field_type = 'Info: ';
      const msg_text = 'FluxOS connection fixed!';
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
    const emoji_title = '\u{1F6A8}';
    const emoji_bell = '\u{1F514}';
    const info_type = 'Alert '+emoji_bell;
    const field_type = 'Error: ';
    const msg_text = "Benchmark "+zelbench_benchmark_status+" \u{274C} \n<b>Reason:</b>\n"+zelbench_error;
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
  const timestamp_paid = moment.unix(Number(lastpaid));
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
    const emoji_title = '\u{1F4A1}';
    const emoji_fixed = '\u{2705}';
    const info_type = 'Fixed Info '+emoji_fixed;
    const field_type = 'Info: ';
    const msg_text = 'Flux daemon fixed!';
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
     const emoji_title = '\u{1F6A8}';
     const emoji_bell = '\u{1F514}';
     const info_type = 'Alert '+emoji_bell;
     const field_type = 'Error: ';
     const msg_text = 'Flux daemon crash detected!';
     await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
     await sleep(2 * 1_000);

   }

   if ( typeof action  == "undefined" || action == "1" ){
      await runShellCommand(`sudo systemctl stop ${fluxdServiceName}`, { timeout: 30000 });
      await sleep(2 * 1_000);
      if (!isArcane) await runShellCommand("sudo fuser -k 16125/tcp", { timeout: 30000 });
      await runShellCommand(`sudo systemctl start ${fluxdServiceName}`, { timeout: 30000 });
      console.log(data_time_utc+' => Flux daemon restarting...');
      await discord_hook("Flux daemon restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

      // Fix action daemon restarted notification telegram
      const emoji_title = '\u{26A1}';
      const emoji_fix = '\u{1F528}';
      const info_type = 'Fix Action '+emoji_fix;
      const field_type = 'Info: ';
      const msg_text = 'Flux daemon restarted!';
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
  const emoji_title = '\u{1F6A8}';
  const emoji_bell = '\u{1F514}';
  const info_type = 'Alert '+emoji_bell;
  const field_type = 'Error: ';
  const msg_text = 'MongoDB crash detected!';
  await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

  await sleep(2 * 1_000);
}

  if (mongod_counter < 3){
      if ( typeof action  == "undefined" || action == "1" ){

          console.log(data_time_utc+' => MongoDB restarting...');
          await runShellCommand("sudo systemctl restart mongod", { timeout: 30000 });
          await discord_hook("MongoDB restarted!",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

          // Fix action mongodb notification telegram
          const emoji_title = '\u{26A1}';
          const emoji_fix = '\u{1F528}';
          const info_type = 'Fix Action '+emoji_fix;
          const field_type = 'Info: ';
          const msg_text = 'MongoDB restarted!';
          await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

      }
  }

return;
} else {

 if (  mongod_counter != 0 ) {

  await discord_hook("MongoDB connection fixed!",web_hook_url,ping,'Fix Info','#1F8B4C','Info','watchdog_fixed2.png',label);

  // Fixed notification mongodb telegram
  const emoji_title = '\u{1F4A1}';
  const emoji_fixed = '\u{2705}';
  const info_type = 'Fixed Info '+emoji_fixed;
  const field_type = 'Info: ';
  const msg_text = 'MongoDB connection fixed!';
  await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);

 }
  mongod_counter=0;
}

if ( zelbench_benchmark_status == "toaster" || zelbench_benchmark_status == "failed" ){
  // Only act if this is a new benchmark failure (zelbench_time is newer than last failure)
  if (zelbench_time && Number(zelbench_time) > last_failure_benchmark_time) {
    ++zelbench_counter;
    last_failure_benchmark_time = Number(zelbench_time);
    const { stdout: error_line } = await runShellCommand(`egrep -a --color 'Failed' ${fluxbenchLogPath} | tail -1 | sed 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}.[0-9]\{2\}.[0-9]\{2\}.[0-9]\{2\}.//'`, { timeout: 30000 });
    error('Benchmark problem detected! Fluxbench status: '+zelbench_benchmark_status);
    error('Reason: '+error_line.trim());
    console.log('Benchmark problem detected! Fluxbench status: '+zelbench_benchmark_status);
    console.log('Reason: '+error_line.trim());
    if ( typeof action  == "undefined" || action == "1" ){

      console.log(data_time_utc+' => Benchmark restart scheduled for next few minutes...');
      await discord_hook("Benchmark restart scheduled!\nBenchmarks will be restarted in the next few minutes.",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

      // Fix action benchmark notification telegram
      const emoji_title = '\u{26A1}';
      const emoji_fix = '\u{1F528}';
      const info_type = 'Fix Action '+emoji_fix;
      const field_type = 'Info: ';
      const msg_text = 'Benchmark restart scheduled! Benchmarks will be restarted in the next few minutes.';
      await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
    }
  }
}
else if ( zelbench_counter != 0 && ["CUMULUS", "NIMBUS", "STRATUS"].includes(zelbench_benchmark_status)) {
  await discord_hook("Flux benchmark fixed!",web_hook_url,ping,'Fix Info','#1F8B4C','Info','watchdog_fixed2.png',label);

  //Fixed benchmark notification telegram
  const emoji_title = '\u{1F4A1}';
  const emoji_fixed = '\u{2705}';
  const info_type = 'Fixed Info '+emoji_fixed;
  const field_type = 'Info: ';
  const msg_text = 'Flux benchmark fixed!';
  await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
  zelbench_counter=0;
  last_failure_benchmark_time=0;
}



delete require.cache[require.resolve('./config.js')];
const config = require('./config.js');

if (config.tier_eps_min != "" && config.tier_eps_min != "0" && zelbench_eps != "" && zelbench_eps < config.tier_eps_min ){
// Only act if this is a new benchmark failure (zelbench_time is newer than last failure)
if (zelbench_time && Number(zelbench_time) > last_failure_benchmark_time) {
  ++tire_lock;
  if ( tire_lock < 4 ) {
    last_failure_benchmark_time = Number(zelbench_time);
    error('Benchmark problem detected! CPU eps under minimum limit for '+tire_name+'('+eps_limit+'), current eps: '+zelbench_eps.toFixed(2));
    console.log('Benchmark problem detected!');
    console.log('CPU eps under minimum limit for '+tire_name+'('+eps_limit+'), current eps: '+zelbench_eps.toFixed(2));
    if ( typeof action  == "undefined" || action == "1" ){

      console.log(data_time_utc+' => Benchmark restart scheduled for next few minutes...');
      await discord_hook("Benchmark restart scheduled!\nBenchmarks will be restarted in the next few minutes.",web_hook_url,ping,'Fix Action','#FFFF00','Info','watchdog_fix1.png',label);

      // Fix action benchmark notification telegram
      const emoji_title = '\u{26A1}';
      const emoji_fix = '\u{1F528}';
      const info_type = 'Fix Action '+emoji_fix;
      const field_type = 'Info: ';
      const msg_text = 'Benchmark restart scheduled! Benchmarks will be restarted in the next few minutes.';
      await send_telegram_msg(emoji_title,info_type,field_type,msg_text,label);
    }
  }
}

} else {
tire_lock=0;
last_failure_benchmark_time=0;
}
 if ( zelcash_height != "" && typeof zelcash_height !== "undefined" && isNumber(zelcash_height) ){
   const skip_sync=between(1, 4);
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

// Main entry point
async function main() {
  try {
    // Initialize configuration once at startup
    await initializeConfig();
  } catch (err) {
    console.error('Error during config initialization:', err);
    console.error('Watchdog will continue with default/existing config values');
    // Don't exit - watchdog should keep running even with config errors
  }

  try {
    // Check Arcane version if running on ArcaneOS
    if (isArcane) {
      await checkArcane();
    }
  } catch (err) {
    console.error('Error during checkArcane:', err);
    console.error('Watchdog will continue without Arcane checks');
    // Don't exit - watchdog should keep running
  }

  // Start the monitoring loop - this should ALWAYS run
  job_creator();
}

// Start the watchdog
main();


