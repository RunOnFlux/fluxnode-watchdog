# WATCHDOG FOR FLUXNODE
<b>How install watchdog:</b>   
```bash -i <(curl -s https://raw.githubusercontent.com/RunOnFlux/fluxnode-multitool/master/multitoolbox.sh)```  

![screen2](https://raw.githubusercontent.com/RunOnFlux/fluxnode-multitool/master/image/w_menu.jpg)

* Use option "2" for new installation diuring install process anser yes when will ask about watchdog install
* For existing node installation use option "4"


<b>Watchdog config file (config.js):</b>

```
Update settings:
zelflux_update - auto update FluxOS
zelcash_update - auto update Flux Daemon
zelbench_update - auto update Flux Benchmark
action - Fixing action (restart mongod, restart daemon, restart benchmark)

0 - option disabled, 1 - option enabled

Discord settings:
web_hook_url - discord hook URL from integration of your discord server
ping - User discord ID 

0 - disabled
set value enabled

Telegram settings:
telegram_alert - telegram mode flage ( 1 - enabled , 0 - disabled )
telegram_bot_token - bot token from BotFather ( dm BotFather /newbot for token more option /start )
telegram_chat_id - chat id from GetIDs Bot ( dm GetIDs Bot /start to get your chat id )

```

<b>Sample config:</b>
```
module.exports = {
    tier_eps_min: '300',
    zelflux_update: '0',
    zelcash_update: '1',
    zelbench_update: '0',
    action: '1',
    ping: '418769606194931713',
    web_hook_url: 'https://discord.com/api/webhooks/844918252704614100/6hB8eHyqGOUMqc7EBe7u4l-sE2ViJKV2_2IzUQw3u0QziVqx3gmBvqWMSpVr8_PIQ0E5',
    telegram_alert: '1',
    telegram_bot_token: '1976199557:AAEgG5sjq2Zy4aAWK-Kw-gWm4yG4vBHb-2a',
    telegram_chat_id: '385527082'
}
```

<b>Watchdog options:</b>
* Auto restart daemon when crash  
* Auto restart benchmark when "failed" or "taoster"
* Auto restart when eps drop belown minim. limit for tier
* Auto restart MongoDB when crash
* Auto-update supported
* KDA node monitoring and fixer
* Logs in real time => type "pm2 monit" and select "watchdog"  
* Log file with error events (~/watchdog/watchdog_error.log)
* Discord integration

![screen5](https://raw.githubusercontent.com/RunOnFlux/fluxnode-multitool/master/image/discord1.png)

* Telegram integration

<b>How correct start, stop, restart watchdog</b>
* Start -> pm2 start watchdog <b>--watch</b> 
* Stop -> pm2 stop watchdog  
* Restart -> pm2 reload watchdog <b>--watch</b>  
  
<b>Any donations are welcomed and appreciated. Thanks.</b>  
<b>https://x4milx.coinrequest.io</b>

```
FLUX: t1f66kBo9xzpgPJV6wvzT7MY6unpm42kvST  
BTC: 1NDVjrP1zg35nfSD1WBKyYSBf8dgJ8AKay  
ETH: 0xf515e0e2ba9347c208418c88a7d75bee3288a010  
LTC: LgST14gr5LH93U8NBeAdFZVwsLzxTBRTq8
```

