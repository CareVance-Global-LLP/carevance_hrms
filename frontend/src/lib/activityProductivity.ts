const PRODUCTIVE_KEYWORDS = [
  'github', 'gitlab', 'bitbucket', 'jira', 'confluence', 'notion', 'slack', 'teams', 'zoom',
  'vscode', 'visual studio', 'intellij', 'pycharm', 'webstorm', 'phpstorm', 'terminal',
  'powershell', 'cmd', 'postman', 'figma', 'miro', 'docs.google', 'sheets.google', 'drive.google',
  'stackoverflow', 'learn.microsoft', 'developer.mozilla', 'trello', 'asana', 'linear', 'clickup',
  'outlook', 'gmail', 'calendar.google', 'word', 'excel', 'powerpoint', 'meet.google',
  'chat.openai', 'chatgpt', 'claude.ai', 'gemini.google', 'code', 'cursor', 'android studio',
  'datagrip', 'dbeaver', 'tableplus', 'mysql workbench', 'navicat', 'canva',
];

const UNPRODUCTIVE_KEYWORDS = [
  'youtube', 'netflix', 'primevideo', 'hotstar', 'spotify', 'instagram', 'facebook', 'twitter',
  'x.com', 'reddit', 'snapchat', 'tiktok', 'discord', 'twitch', 'pinterest', '9gag',
  'telegram', 'whatsapp', 'web.whatsapp', 'wa.me', 'fb.com', 'reels', 'shorts', 'cricbuzz', 'espncricinfo',
];

const BROWSER_TITLE_PATTERNS = [
  /^(google chrome|chrome|microsoft edge|edge|mozilla firefox|firefox|brave|opera|vivaldi)\s*-\s*/i,
  /\s*-\s*(google chrome|chrome|microsoft edge|edge|mozilla firefox|firefox|brave|opera|vivaldi)$/i,
];

const BROWSER_APP_KEYWORDS = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'safari', 'vivaldi'];

const KNOWN_SITE_LABELS: Array<{ label: string; keywords: string[] }> = [
  { label: 'instagram.com', keywords: ['instagram'] },
  { label: 'youtube.com', keywords: ['youtube', 'youtu.be'] },
  { label: 'netflix.com', keywords: ['netflix'] },
  { label: 'spotify.com', keywords: ['spotify'] },
  { label: 'facebook.com', keywords: ['facebook', 'fb.com'] },
  { label: 'x.com', keywords: ['x.com', 'twitter'] },
  { label: 'reddit.com', keywords: ['reddit'] },
  { label: 'tiktok.com', keywords: ['tiktok'] },
  { label: 'discord.com', keywords: ['discord'] },
  { label: 'web.whatsapp.com', keywords: ['web.whatsapp', 'whatsapp', 'wa.me'] },
  { label: 'twitch.tv', keywords: ['twitch'] },
  { label: 'pinterest.com', keywords: ['pinterest'] },
  { label: 'telegram.org', keywords: ['telegram'] },
  { label: 'primevideo.com', keywords: ['primevideo'] },
  { label: 'hotstar.com', keywords: ['hotstar'] },
  { label: 'cricbuzz.com', keywords: ['cricbuzz'] },
  { label: 'espncricinfo.com', keywords: ['espncricinfo'] },
  { label: 'github.com', keywords: ['github'] },
  { label: 'gitlab.com', keywords: ['gitlab'] },
  { label: 'bitbucket.org', keywords: ['bitbucket'] },
  { label: 'stackoverflow.com', keywords: ['stackoverflow'] },
  { label: 'figma.com', keywords: ['figma'] },
  { label: 'miro.com', keywords: ['miro'] },
  { label: 'canva.com', keywords: ['canva'] },
  { label: 'trello.com', keywords: ['trello'] },
  { label: 'asana.com', keywords: ['asana'] },
  { label: 'linear.app', keywords: ['linear'] },
  { label: 'clickup.com', keywords: ['clickup'] },
  { label: 'developer.mozilla.org', keywords: ['developer.mozilla'] },
  { label: 'learn.microsoft.com', keywords: ['learn.microsoft'] },
  { label: 'chat.openai.com', keywords: ['chat.openai', 'chatgpt'] },
  { label: 'claude.ai', keywords: ['claude.ai'] },
  { label: 'gemini.google', keywords: ['gemini.google'] },
  { label: 'snapchat.com', keywords: ['snapchat'] },
  { label: '9gag.com', keywords: ['9gag'] },
];

const APP_NAME_ALIASES: Record<string, string> = {
  'code.exe': 'Visual Studio Code',
  'code': 'Visual Studio Code',
  'vscode.exe': 'Visual Studio Code',
  'vscode': 'Visual Studio Code',
  'electron.exe': 'Visual Studio Code',
  'cursor.exe': 'Cursor',
  'android studio.exe': 'Android Studio',
  'studio64.exe': 'Android Studio',
  'idea64.exe': 'IntelliJ IDEA',
  'idea.exe': 'IntelliJ IDEA',
  'pycharm64.exe': 'PyCharm',
  'pycharm.exe': 'PyCharm',
  'webstorm64.exe': 'WebStorm',
  'webstorm.exe': 'WebStorm',
  'phpstorm64.exe': 'PhpStorm',
  'phpstorm.exe': 'PhpStorm',
  'datagrip64.exe': 'DataGrip',
  'datagrip.exe': 'DataGrip',
  'clion64.exe': 'CLion',
  'clion.exe': 'CLion',
  'rider64.exe': 'Rider',
  'rider.exe': 'Rider',
  'goland64.exe': 'GoLand',
  'goland.exe': 'GoLand',
  'rubymine64.exe': 'RubyMine',
  'rubymine.exe': 'RubyMine',
  'sublime_text.exe': 'Sublime Text',
  'sublime.exe': 'Sublime Text',
  'notepad++.exe': 'Notepad++',
  'atom.exe': 'Atom',
  'brackets.exe': 'Brackets',
  'xcode.exe': 'Xcode',
  'winword.exe': 'Microsoft Word',
  'word.exe': 'Microsoft Word',
  'excel.exe': 'Microsoft Excel',
  'powerpnt.exe': 'Microsoft PowerPoint',
  'ppt.exe': 'Microsoft PowerPoint',
  'outlook.exe': 'Microsoft Outlook',
  'msaccess.exe': 'Microsoft Access',
  'access.exe': 'Microsoft Access',
  'mspub.exe': 'Microsoft Publisher',
  'publisher.exe': 'Microsoft Publisher',
  'onenote.exe': 'Microsoft OneNote',
  'onenotem.exe': 'Microsoft OneNote',
  'msproject.exe': 'Microsoft Project',
  'project.exe': 'Microsoft Project',
  'visio.exe': 'Microsoft Visio',
  'teams.exe': 'Microsoft Teams',
  'microsoft.teams.exe': 'Microsoft Teams',
  'slack.exe': 'Slack',
  'zoom.exe': 'Zoom',
  'discord.exe': 'Discord',
  'telegram.exe': 'Telegram Desktop',
  'whatsapp.exe': 'WhatsApp Desktop',
  'signal.exe': 'Signal',
  'notion.exe': 'Notion',
  'notion calendar.exe': 'Notion Calendar',
  'obsidian.exe': 'Obsidian',
  'logseq.exe': 'Logseq',
  'roam.exe': 'Roam Research',
  'chrome.exe': 'Google Chrome',
  'msedge.exe': 'Microsoft Edge',
  'firefox.exe': 'Mozilla Firefox',
  'brave.exe': 'Brave Browser',
  'opera.exe': 'Opera',
  'vivaldi.exe': 'Vivaldi',
  'safari.exe': 'Safari',
  'postman.exe': 'Postman',
  'insomnia.exe': 'Insomnia',
  'figma.exe': 'Figma',
  'miro.exe': 'Miro',
  'canva.exe': 'Canva',
  'dbeaver.exe': 'DBeaver',
  'tableplus.exe': 'TablePlus',
  'mysql workbench.exe': 'MySQL Workbench',
  'navicat.exe': 'Navicat',
  'winscp.exe': 'WinSCP',
  'putty.exe': 'PuTTY',
  'terminus.exe': 'Terminus',
  'warp.exe': 'Warp',
  'iterm2.exe': 'iTerm2',
  'terminal.exe': 'Windows Terminal',
  'windowsterminal.exe': 'Windows Terminal',
  'powershell.exe': 'PowerShell',
  'cmd.exe': 'Command Prompt',
  'git-bash.exe': 'Git Bash',
  'git bash.exe': 'Git Bash',
  'bash.exe': 'Git Bash',
  'conhost.exe': 'Command Prompt',
  'acrobat.exe': 'Adobe Acrobat',
  'acrobat32.exe': 'Adobe Acrobat',
  'acrord32.exe': 'Adobe Acrobat Reader',
  'acrord64.exe': 'Adobe Acrobat Reader',
  'reader.exe': 'Adobe Acrobat Reader',
  'photoshop.exe': 'Adobe Photoshop',
  'photoshopelements.exe': 'Adobe Photoshop Elements',
  'illustrator.exe': 'Adobe Illustrator',
  'indesign.exe': 'Adobe InDesign',
  'premiere.exe': 'Adobe Premiere Pro',
  'premiere pro.exe': 'Adobe Premiere Pro',
  'afterfx.exe': 'Adobe After Effects',
  'after effects.exe': 'Adobe After Effects',
  'lightroom.exe': 'Adobe Lightroom',
  'lightroomclassic.exe': 'Adobe Lightroom Classic',
  'xd.exe': 'Adobe XD',
  'adobe xd.exe': 'Adobe XD',
  'spotify.exe': 'Spotify',
  'vlc.exe': 'VLC Media Player',
  'wmplayer.exe': 'Windows Media Player',
  'mpc-hc64.exe': 'Media Player Classic',
  'mpc-hc.exe': 'Media Player Classic',
  'steam.exe': 'Steam',
  'epicgameslauncher.exe': 'Epic Games Launcher',
  'goggalaxy.exe': 'GOG Galaxy',
  'ubisoftconnect.exe': 'Ubisoft Connect',
  'battle.net.exe': 'Blizzard Battle.net',
  'xboxapp.exe': 'Xbox',
  'explorer.exe': 'File Explorer',
  'file explorer.exe': 'File Explorer',
  'taskmgr.exe': 'Task Manager',
  'msconfig.exe': 'System Configuration',
  'calc.exe': 'Calculator',
  'notepad.exe': 'Notepad',
  'paint.exe': 'Paint',
  'mspaint.exe': 'Paint',
  'snippingtool.exe': 'Snipping Tool',
  'screenclip.exe': 'Snip & Sketch',
  'regedit.exe': 'Registry Editor',
  'mmc.exe': 'Microsoft Management Console',
  'services.msc.exe': 'Services',
  'gpedit.msc.exe': 'Group Policy Editor',
  'control.exe': 'Control Panel',
  'sysdm.cpl.exe': 'System Properties',
  'appwiz.cpl.exe': 'Programs and Features',
  'docker desktop.exe': 'Docker Desktop',
  'docker.exe': 'Docker Desktop',
  'kubectl.exe': 'kubectl',
  'vmware.exe': 'VMware Workstation',
  'vmplayer.exe': 'VMware Player',
  'virtualbox.exe': 'Oracle VM VirtualBox',
  'vboxmanage.exe': 'VirtualBox',
  'wsl.exe': 'WSL',
  'ubuntu.exe': 'Ubuntu on WSL',
  'mongosh.exe': 'MongoDB Shell',
  'mongo.exe': 'MongoDB Shell',
  'compass.exe': 'MongoDB Compass',
  'mongodb compass.exe': 'MongoDB Compass',
  'redis-server.exe': 'Redis Server',
  'redis-cli.exe': 'Redis CLI',
  'nginx.exe': 'Nginx',
  'httpd.exe': 'Apache HTTP Server',
  'mysqld.exe': 'MySQL Server',
  'postgres.exe': 'PostgreSQL Server',
  'sqlserver.exe': 'SQL Server',
  'ssms.exe': 'SQL Server Management Studio',
  'azure data studio.exe': 'Azure Data Studio',
  'azuredatastudio.exe': 'Azure Data Studio',
  'oracle.exe': 'Oracle Database',
  'sqlplus.exe': 'SQL*Plus',
  'sqldeveloper.exe': 'SQL Developer',
  'winrar.exe': 'WinRAR',
  'winzip.exe': 'WinZip',
  '7z.exe': '7-Zip',
  '7zfm.exe': '7-Zip File Manager',
  'bandizip.exe': 'Bandizip',
  'utorrent.exe': 'µTorrent',
  'qbittorrent.exe': 'qBittorrent',
  'transmission.exe': 'Transmission',
  'obs64.exe': 'OBS Studio',
  'obs32.exe': 'OBS Studio',
  'obs studio.exe': 'OBS Studio',
  'sharex.exe': 'ShareX',
  'greenshot.exe': 'Greenshot',
  'snagit.exe': 'Snagit',
  'camtasia.exe': 'Camtasia',
  'audacity.exe': 'Audacity',
  'gimp.exe': 'GIMP',
  'inkscape.exe': 'Inkscape',
  'blender.exe': 'Blender',
  'unity.exe': 'Unity Editor',
  'unityhub.exe': 'Unity Hub',
  'unrealeditor.exe': 'Unreal Engine',
  'godot.exe': 'Godot Engine',
  'jupyter.exe': 'Jupyter',
  'jupyter lab.exe': 'JupyterLab',
  'anaconda.exe': 'Anaconda',
  'anaconda3.exe': 'Anaconda',
  'miniconda.exe': 'Miniconda',
  'wireshark.exe': 'Wireshark',
  'burpsuite.exe': 'Burp Suite',
  'nmap.exe': 'Nmap',
  'metasploit.exe': 'Metasploit',
  'filezilla.exe': 'FileZilla',
  'cyberduck.exe': 'Cyberduck',
  'transmit.exe': 'Transmit',
  'teamviewer.exe': 'TeamViewer',
  'anydesk.exe': 'AnyDesk',
  'rustdesk.exe': 'RustDesk',
  'logmein.exe': 'LogMeIn',
  'splashtop.exe': 'Splashtop',
  'vncserver.exe': 'VNC Server',
  'vncviewer.exe': 'VNC Viewer',
  'fiddler.exe': 'Fiddler',
  'charles.exe': 'Charles Proxy',
  'proxyman.exe': 'Proxyman',
  'ngrok.exe': 'ngrok',
  '1password.exe': '1Password',
  'bitwarden.exe': 'Bitwarden',
  'lastpass.exe': 'LastPass',
  'dashlane.exe': 'Dashlane',
  'keepass.exe': 'KeePass',
  'keepassxc.exe': 'KeePassXC',
  'nod32.exe': 'ESET NOD32',
  'ekrn.exe': 'ESET Security',
  'avg.exe': 'AVG Antivirus',
  'avast.exe': 'Avast Antivirus',
  'mbam.exe': 'Malwarebytes',
  'mbamservice.exe': 'Malwarebytes',
  'windowsdefender.exe': 'Windows Defender',
  'msseces.exe': 'Microsoft Security Essentials',
  'thunderbird.exe': 'Mozilla Thunderbird',
  'mail.exe': 'Windows Mail',
  'calendar.exe': 'Windows Calendar',
  'people.exe': 'Windows People',
  'alarms.exe': 'Windows Alarms',
  'clock.exe': 'Windows Clock',
  'maps.exe': 'Windows Maps',
  'weather.exe': 'Windows Weather',
  'photos.exe': 'Windows Photos',
  'windows photos.exe': 'Windows Photos',
  'videoplayer.exe': 'Windows Video Player',
  'solitaire.exe': 'Microsoft Solitaire',
  'xbox.exe': 'Xbox Console Companion',
  'powershell_ise.exe': 'PowerShell ISE',
  'python.exe': 'Python',
  'python3.exe': 'Python 3',
  'node.exe': 'Node.js',
  'npm.exe': 'npm',
  'yarn.exe': 'Yarn',
  'pnpm.exe': 'pnpm',
  'npx.exe': 'npx',
  'git.exe': 'Git',
  'gitk.exe': 'GitKraken',
  'gitkraken.exe': 'GitKraken',
  'sourcetree.exe': 'SourceTree',
  'github desktop.exe': 'GitHub Desktop',
  'github.exe': 'GitHub Desktop',
  'desktop.exe': 'GitHub Desktop',
  'bruno.exe': 'Bruno',
  'joplin.exe': 'Joplin',
  'evernote.exe': 'Evernote',
  'todoist.exe': 'Todoist',
  'microsoft todo.exe': 'Microsoft To Do',
  'wunderlist.exe': 'Wunderlist',
  'ticktick.exe': 'TickTick',
  'any.do.exe': 'Any.do',
  'microsoft whiteboard.exe': 'Microsoft Whiteboard',
  'draw.io.exe': 'draw.io',
  'lucidchart.exe': 'Lucidchart',
  'figjam.exe': 'FigJam',
  'mural.exe': 'Mural',
  'excalidraw.exe': 'Excalidraw',
  'adobe creative cloud.exe': 'Adobe Creative Cloud',
  'creative cloud.exe': 'Adobe Creative Cloud',
  'dropbox.exe': 'Dropbox',
  'googledrive.exe': 'Google Drive',
  'google drive.exe': 'Google Drive',
  'onedrive.exe': 'OneDrive',
  'icloud.exe': 'iCloud',
  'mega.exe': 'MEGA Sync',
  'nextcloud.exe': 'Nextcloud',
  'syncthing.exe': 'Syncthing',
  'resilio.exe': 'Resilio Sync',
  'backup and sync.exe': 'Google Backup & Sync',
  'backupandsync.exe': 'Google Backup & Sync',
  'hubic.exe': 'HubiC',
  'pcloud.exe': 'pCloud',
  'icedrive.exe': 'IceDrive',
  'koofr.exe': 'Koofr',
  'jdownloader.exe': 'JDownloader',
  'free download manager.exe': 'Free Download Manager',
  'fdm.exe': 'Free Download Manager',
  'internet download manager.exe': 'Internet Download Manager',
  'idman.exe': 'Internet Download Manager',
  'xdown.exe': 'XDown',
  'motrix.exe': 'Motrix',
  'persepolis.exe': 'Persepolis Download Manager',
  'bitcomet.exe': 'BitComet',
  'deluge.exe': 'Deluge',
  'tixati.exe': 'Tixati',
  'vuze.exe': 'Vuze',
  'aria2c.exe': 'aria2',
  'youtube-dl.exe': 'youtube-dl',
  'yt-dlp.exe': 'yt-dlp',
  'ffmpeg.exe': 'FFmpeg',
  'handbrake.exe': 'HandBrake',
  'makemkv.exe': 'MakeMKV',
  'format factory.exe': 'Format Factory',
  'freemake.exe': 'Freemake Video Converter',
  'any video converter.exe': 'Any Video Converter',
  'davinci resolve.exe': 'DaVinci Resolve',
  'resolve.exe': 'DaVinci Resolve',
  'hitfilm.exe': 'HitFilm Express',
  'shotcut.exe': 'Shotcut',
  'kdenlive.exe': 'Kdenlive',
  'openshot.exe': 'OpenShot',
  'avidemux.exe': 'Avidemux',
  'losslesscut.exe': 'LosslessCut',
  'ocenaudio.exe': 'Ocenaudio',
  'reaper.exe': 'REAPER',
  'ableton live.exe': 'Ableton Live',
  'ableton.exe': 'Ableton Live',
  'fl64.exe': 'FL Studio',
  'fl studio.exe': 'FL Studio',
  'cubase.exe': 'Cubase',
  'logic pro.exe': 'Logic Pro',
  'protools.exe': 'Pro Tools',
  'studio one.exe': 'Studio One',
  'maschine.exe': 'Maschine',
  'serato.exe': 'Serato DJ',
  'traktor.exe': 'Traktor',
  'virtual dj.exe': 'Virtual DJ',
  'mixxx.exe': 'Mixxx',
  'lmms.exe': 'LMMS',
  'sunvox.exe': 'SunVox',
  'musescore.exe': 'MuseScore',
  'musescore3.exe': 'MuseScore 3',
  'musescore4.exe': 'MuseScore 4',
  'tuxguitar.exe': 'TuxGuitar',
  'guitar pro.exe': 'Guitar Pro',
  'powertab.exe': 'PowerTab',
  'tabit.exe': 'TablEdit',
  'finale.exe': 'Finale',
  'sibelius.exe': 'Sibelius',
  'dorico.exe': 'Dorico',
  'atp.exe': 'Accurate Transcription',
  'transcribe.exe': 'Transcribe!',
  'amazing slowdowner.exe': 'Amazing Slow Downer',
  'anytune.exe': 'AnyTune',
  'capo.exe': 'Capo',
  'vocable.exe': 'Vocable',
  'tunetranscriber.exe': 'Tune Transcriber',
  'anthemview.exe': 'AnthemView',
  'songbook.exe': 'SongBook',
  'onsong.exe': 'OnSong',
  'setlist.exe': 'Set List Maker',
  'bandhelper.exe': 'BandHelper',
  'multitrack.exe': 'MultiTrack DAW',
  'acoustica.exe': 'Acoustica',
  'mixcraft.exe': 'Mixcraft',
  'n-track.exe': 'n-Track Studio',
  'mixing station.exe': 'Mixing Station',
  'xfrog.exe': 'XFrog',
  'audiodamage.exe': 'Audio Damage',
  'native access.exe': 'Native Instruments Access',
  'komplete kontrol.exe': 'Komplete Kontrol',
  'reaktor.exe': 'Reaktor',
  'kontakt.exe': 'Kontakt',
  'fm8.exe': 'FM8',
  'massive.exe': 'Massive',
  'absynth.exe': 'Absynth',
  'razor.exe': 'Razor',
  'prism.exe': 'Prism',
  'skanner.exe': 'Skanner XT',
  'spektral delay.exe': 'Spektral Delay',
  'the finger.exe': 'The Finger',
  'the mouth.exe': 'The Mouth',
  'guitar rig.exe': 'Guitar Rig',
  'rekordbox.exe': 'rekordbox',
  'serato dj.exe': 'Serato DJ',
  'virtualdj.exe': 'VirtualDJ',
  'cross dj.exe': 'Cross DJ',
  'djay.exe': 'djay',
  'dj pro.exe': 'DJ Pro',
  'dj studio.exe': 'DJ Studio',
  'djing.exe': 'DJing',
  'djuced.exe': 'DJUced',
  'mixmeister.exe': 'MixMeister',
  'nuendo.exe': 'Nuendo',
  'reason.exe': 'Reason',
  'bitwig.exe': 'Bitwig Studio',
  'renoise.exe': 'Renoise',
  'klystrack.exe': 'Klystrack',
  'furnace.exe': 'Furnace',
  'deflemask.exe': 'DefleMask',
  'famitracker.exe': 'FamiTracker',
  'openmpt.exe': 'OpenMPT',
  'schism.exe': 'Schism Tracker',
  'milky tracker.exe': 'MilkyTracker',
  'goattracker.exe': 'GoatTracker',
  'hivelytracker.exe': 'HivelyTracker',
  'buzz.exe': 'Buzz',
  'jeskola buzz.exe': 'Jeskola Buzz',
  'psycle.exe': 'Psycle',
  'protracker.exe': 'ProTracker',
  'octamed.exe': 'OctaMED',
  'fasttracker.exe': 'FastTracker 2',
  'impulse tracker.exe': 'Impulse Tracker',
  'scream tracker.exe': 'Scream Tracker',
  'modplug tracker.exe': 'ModPlug Tracker',
  'wavosaur.exe': 'Wavosaur',
  'goldwave.exe': 'GoldWave',
  'soundedit.exe': 'Sound Editor',
  'wavpad.exe': 'WavPad',
  'mp3directcut.exe': 'MP3DirectCut',
  'mp3gain.exe': 'MP3Gain',
  'aacgain.exe': 'AACGain',
  'easy mp3 gain.exe': 'Easy MP3 Gain',
  'mp3tag.exe': 'Mp3tag',
  'tagscanner.exe': 'TagScanner',
  'musicbrainz picard.exe': 'MusicBrainz Picard',
  'beets.exe': 'beets',
  'foobar2000.exe': 'foobar2000',
  'musicbee.exe': 'MusicBee',
  'aimp.exe': 'AIMP',
  'winamp.exe': 'Winamp',
  'media monkey.exe': 'MediaMonkey',
  'clementine.exe': 'Clementine',
  'strawberry.exe': 'Strawberry',
  'sayonara.exe': 'Sayonara',
  'deadbeef.exe': 'DeaDBeeF',
  'qtractor.exe': 'Qtractor',
  'ardour.exe': 'Ardour',
  'rosegarden.exe': 'Rosegarden',
  'muse.exe': 'Muse',
  'denemo.exe': 'Denemo',
  'frescobaldi.exe': 'Frescobaldi',
  'lilypond.exe': 'LilyPond',
  'abc2svg.exe': 'abc2svg',
  'easyabc.exe': 'EasyABC',
};

// Common window title patterns for desktop apps: "content - AppName" or "content - AppName edition"
const APP_TITLE_PATTERNS = [
  { pattern: /\s*[-–—|]\s*(Visual Studio Code|VS Code|VSCode)\s*$/i, appName: 'Visual Studio Code' },
  { pattern: /\s*[-–—|]\s*(Microsoft Word|Word)\s*$/i, appName: 'Microsoft Word' },
  { pattern: /\s*[-–—|]\s*(Microsoft Excel|Excel)\s*$/i, appName: 'Microsoft Excel' },
  { pattern: /\s*[-–—|]\s*(Microsoft PowerPoint|PowerPoint)\s*$/i, appName: 'Microsoft PowerPoint' },
  { pattern: /\s*[-–—|]\s*(Microsoft Outlook|Outlook)\s*$/i, appName: 'Microsoft Outlook' },
  { pattern: /\s*[-–—|]\s*(Microsoft Teams|Teams)\s*$/i, appName: 'Microsoft Teams' },
  { pattern: /\s*[-–—|]\s*(Slack)\s*$/i, appName: 'Slack' },
  { pattern: /\s*[-–—|]\s*(Notion)\s*$/i, appName: 'Notion' },
  { pattern: /\s*[-–—|]\s*(IntelliJ IDEA)\s*$/i, appName: 'IntelliJ IDEA' },
  { pattern: /\s*[-–—|]\s*(PyCharm)\s*$/i, appName: 'PyCharm' },
  { pattern: /\s*[-–—|]\s*(WebStorm)\s*$/i, appName: 'WebStorm' },
  { pattern: /\s*[-–—|]\s*(PhpStorm)\s*$/i, appName: 'PhpStorm' },
  { pattern: /\s*[-–—|]\s*(DataGrip)\s*$/i, appName: 'DataGrip' },
  { pattern: /\s*[-–—|]\s*(Android Studio)\s*$/i, appName: 'Android Studio' },
  { pattern: /\s*[-–—|]\s*(Cursor)\s*$/i, appName: 'Cursor' },
  { pattern: /\s*[-–—|]\s*(Sublime Text)\s*$/i, appName: 'Sublime Text' },
  { pattern: /\s*[-–—|]\s*(Notepad\+\+)\s*$/i, appName: 'Notepad++' },
  { pattern: /\s*[-–—|]\s*(GitHub Desktop)\s*$/i, appName: 'GitHub Desktop' },
  { pattern: /\s*[-–—|]\s*(SourceTree)\s*$/i, appName: 'SourceTree' },
  { pattern: /\s*[-–—|]\s*(GitKraken)\s*$/i, appName: 'GitKraken' },
  { pattern: /\s*[-–—|]\s*(Terminal)\s*$/i, appName: 'Windows Terminal' },
  { pattern: /\s*[-–—|]\s*(Windows Terminal)\s*$/i, appName: 'Windows Terminal' },
  { pattern: /\s*[-–—|]\s*(PowerShell)\s*$/i, appName: 'PowerShell' },
  { pattern: /\s*[-–—|]\s*(Adobe Acrobat(?: Reader)? DC)\s*$/i, appName: 'Adobe Acrobat' },
  { pattern: /\s*[-–—|]\s*(Adobe Photoshop)\s*$/i, appName: 'Adobe Photoshop' },
  { pattern: /\s*[-–—|]\s*(Adobe Illustrator)\s*$/i, appName: 'Adobe Illustrator' },
  { pattern: /\s*[-–—|]\s*(File Explorer)\s*$/i, appName: 'File Explorer' },
  { pattern: /\s*[-–—|]\s*(Docker Desktop)\s*$/i, appName: 'Docker Desktop' },
  { pattern: /\s*[-–—|]\s*(Spotify)\s*$/i, appName: 'Spotify' },
  { pattern: /\s*[-–—|]\s*(Discord)\s*$/i, appName: 'Discord' },
  { pattern: /\s*[-–—|]\s*(Zoom)\s*$/i, appName: 'Zoom' },
  { pattern: /\s*[-–—|]\s*(Telegram)\s*$/i, appName: 'Telegram Desktop' },
  { pattern: /\s*[-–—|]\s*(WhatsApp)\s*$/i, appName: 'WhatsApp Desktop' },
  { pattern: /\s*[-–—|]\s*(Obsidian)\s*$/i, appName: 'Obsidian' },
  { pattern: /\s*[-–—|]\s*(Logseq)\s*$/i, appName: 'Logseq' },
  { pattern: /\s*[-–—|]\s*(Postman)\s*$/i, appName: 'Postman' },
  { pattern: /\s*[-–—|]\s*(Insomnia)\s*$/i, appName: 'Insomnia' },
  { pattern: /\s*[-–—|]\s*(Figma)\s*$/i, appName: 'Figma' },
  { pattern: /\s*[-–—|]\s*(DBeaver)\s*$/i, appName: 'DBeaver' },
  { pattern: /\s*[-–—|]\s*(TablePlus)\s*$/i, appName: 'TablePlus' },
  { pattern: /\s*[-–—|]\s*(Wireshark)\s*$/i, appName: 'Wireshark' },
  { pattern: /\s*[-–—|]\s*(PuTTY)\s*$/i, appName: 'PuTTY' },
  { pattern: /\s*[-–—|]\s*(FileZilla)\s*$/i, appName: 'FileZilla' },
  { pattern: /\s*[-–—|]\s*(VMware Workstation)\s*$/i, appName: 'VMware Workstation' },
  { pattern: /\s*[-–—|]\s*(VirtualBox)\s*$/i, appName: 'VirtualBox' },
  { pattern: /\s*[-–—|]\s*(OBS Studio)\s*$/i, appName: 'OBS Studio' },
  { pattern: /\s*[-–—|]\s*(Blender)\s*$/i, appName: 'Blender' },
  { pattern: /\s*[-–—|]\s*(Unity)\s*$/i, appName: 'Unity' },
  { pattern: /\s*[-–—|]\s*(Calibre)\s*$/i, appName: 'Calibre' },
  { pattern: /\s*[-–—|]\s*(SumatraPDF)\s*$/i, appName: 'SumatraPDF' },
  { pattern: /\s*[-–—|]\s*(Foxit(?:Reader)?)\s*$/i, appName: 'Foxit Reader' },
  { pattern: /\s*[-–—|]\s*(VLC media player)\s*$/i, appName: 'VLC Media Player' },
  { pattern: /\s*[-–—|]\s*(Steam)\s*$/i, appName: 'Steam' },
  { pattern: /\s*[-–—|]\s*(Epic Games Launcher)\s*$/i, appName: 'Epic Games Launcher' },
  { pattern: /\s*[-–—|]\s*(GOG Galaxy)\s*$/i, appName: 'GOG Galaxy' },
  { pattern: /\s*[-–—|]\s*(Battle\.net)\s*$/i, appName: 'Blizzard Battle.net' },
  { pattern: /\s*[-–—|]\s*(Xbox)\s*$/i, appName: 'Xbox' },
  { pattern: /\s*[-–—|]\s*(Paint\.NET|paint\.net|Paint\.net)\s*$/i, appName: 'Paint.NET' },
  { pattern: /\s*[-–—|]\s*(GIMP)\s*$/i, appName: 'GIMP' },
  { pattern: /\s*[-–—|]\s*(Inkscape)\s*$/i, appName: 'Inkscape' },
  { pattern: /\s*[-–—|]\s*(Krita)\s*$/i, appName: 'Krita' },
];

const formatUniversalAppName = (appName: string): string => {
  const cleaned = appName
    .replace(/\.exe$/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const resolveExeDisplayName = (appName: string): string | null => {
  const key = String(appName || '').trim().toLowerCase();
  if (!key) return null;

  // Direct match in the alias map (with .exe stripped for comparison)
  const exactMatch = APP_NAME_ALIASES[key];
  if (exactMatch) return exactMatch;

  // Try without .exe extension
  const withoutExe = key.replace(/\.exe$/i, '');
  if (withoutExe !== key) {
    const match = APP_NAME_ALIASES[withoutExe];
    if (match) return match;
    const exeMatch = APP_NAME_ALIASES[withoutExe + '.exe'];
    if (exeMatch) return exeMatch;
  }

  // Try with .exe
  const withExe = key.endsWith('.exe') ? key : key + '.exe';
  const matchWithExe = APP_NAME_ALIASES[withExe];
  if (matchWithExe) return matchWithExe;

  // Universal fallback: format any unknown app name nicely
  return formatUniversalAppName(appName);
};

export const guessToolType = (activityType: string) =>
  String(activityType || '').trim().toLowerCase() === 'url' ? 'website' : 'software';

export const cleanBrowserWindowTitle = (title: string) => {
  let value = String(title || '').trim().replace(/^\(\d+\)\s*/u, '');

  if (!value) {
    return value;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const previous = value;

    BROWSER_TITLE_PATTERNS.forEach((pattern) => {
      value = value.replace(pattern, '').trim();
    });

    if (value === previous) {
      break;
    }
  }

  return value.replace(/\s+/g, ' ').trim();
};

const resolveKnownSiteLabel = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  const matchedSite = KNOWN_SITE_LABELS.find(({ keywords }) => keywords.some((keyword) => normalized.includes(keyword)));
  return matchedSite?.label || '';
};

const decodePercentEncodedText = (value: string) => {
  const source = String(value || '').trim();
  if (!source || !source.includes('%')) {
    return source;
  }

  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
};

const looksLikeResolvableUrl = (value: string) => {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return false;
  }

  return /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
    || /^www\./i.test(candidate)
    || /^localhost(?::\d+)?(?:\/|$)/i.test(candidate)
    || /^127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(candidate)
    || /([a-z0-9-]+\.)+[a-z]{2,}/i.test(candidate);
};

export const normalizeActivityToolLabel = (name: string, activityType: string) => {
  const trimmed = String(name || '').trim();
  const normalizedType = String(activityType || '').trim().toLowerCase();

  if (!trimmed) {
    return normalizedType === 'url' ? 'unknown-site' : 'unknown-app';
  }

  if (normalizedType === 'url') {
    const decodedValue = decodePercentEncodedText(trimmed);

    if (looksLikeResolvableUrl(decodedValue)) {
      try {
        const parsed = new URL(decodedValue.includes('://') ? decodedValue : `https://${decodedValue}`);
        return parsed.hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        const match = decodedValue.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
        if (match?.[0]) {
          return match[0].replace(/^www\./, '').toLowerCase();
        }
      }
    } else {
      const match = decodedValue.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
      if (match?.[0]) {
        return match[0].replace(/^www\./, '').toLowerCase();
      }
    }

    const cleanedTitle = cleanBrowserWindowTitle(decodedValue);
    const knownSiteLabel = resolveKnownSiteLabel(cleanedTitle);
    if (knownSiteLabel) {
      return knownSiteLabel;
    }

    return cleanedTitle.slice(0, 120) || 'browser';
  }

  return trimmed.slice(0, 120);
};

export const classifyActivityProductivity = (toolLabel: string, activityType: string) => {
  const text = String(toolLabel || '').toLowerCase();
  const normalizedType = String(activityType || '').trim().toLowerCase();
  const isProductive = PRODUCTIVE_KEYWORDS.some((keyword) => text.includes(keyword));
  const isUnproductive = UNPRODUCTIVE_KEYWORDS.some((keyword) => text.includes(keyword));

  if (isUnproductive && !isProductive) return 'unproductive';
  if (isProductive && !isUnproductive) return 'productive';
  if (normalizedType === 'idle') return 'neutral';
  if (normalizedType === 'url' || normalizedType === 'app') return 'productive';
  return 'neutral';
};

const extractAppNameFromTitle = (title: string): string | null => {
  for (const { pattern, appName } of APP_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return appName;
    }
  }
  return null;
};

export const buildTrackedContextName = (context: { app?: string | null; title?: string | null; url?: string | null; description?: string | null }) => {
  const appName = String(context?.app || '').trim();
  const title = String(context?.title || '').trim();
  const url = String(context?.url || '').trim();
  const description = String(context?.description || '').trim();
  const isBrowserApp = BROWSER_APP_KEYWORDS.some((keyword) => appName.toLowerCase().includes(keyword));

  if (url) {
    return url.slice(0, 255);
  }

  if (isBrowserApp && title) {
    const cleanedTitle = cleanBrowserWindowTitle(title);
    return (cleanedTitle || title).slice(0, 255);
  }

  // Resolve the app name: description (from PowerShell) > alias map > raw app name
  const resolvedAppName = description || resolveExeDisplayName(appName) || appName;

  if (title) {
    // Try to extract app name from common title patterns like "document.pdf - Adobe Acrobat Reader DC"
    const extractedApp = extractAppNameFromTitle(title);
    if (extractedApp) {
      return `${extractedApp}: ${title.replace(/\s*[-–—|]\s*[\w\s]+$/i, '').trim()}`.slice(0, 255);
    }

    // If title contains the app name or is a well-formed pair, return "AppName: content"
    const titleLower = title.toLowerCase();
    const resolvedLower = resolvedAppName.toLowerCase();
    if (titleLower.includes(resolvedLower) || resolvedLower.includes(titleLower)) {
      return resolvedAppName.slice(0, 255);
    }

    return `${resolvedAppName}: ${title}`.slice(0, 255);
  }

  return resolvedAppName.slice(0, 255);
};

export { resolveExeDisplayName };