const express = require('express');
const cors = require('cors');
const { addonBuilder } = require('stremio-addon-sdk');
const PlaylistTransformer = require('./playlist-transformer');
const { catalogHandler, streamHandler } = require('./handlers');
const metaHandler = require('./meta-handler');
const EPGManager = require('./epg-manager');
const config = require('./config');
const CacheManager = require('./cache-manager')(config);
const { renderConfigPage } = require('./views');
const PythonRunner = require('./python-runner');
const ResolverStreamManager = require('./resolver-stream-manager')();
const PythonResolver = require('./python-resolver');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Main route - supports both old and new system
app.get('/', async (req, res) => {
   const protocol = req.headers['x-forwarded-proto'] || req.protocol;
   const host = req.headers['x-forwarded-host'] || req.get('host');
   res.send(renderConfigPage(protocol, host, req.query, config.manifest));
});

// New route for encoded configuration
app.get('/:config/configure', async (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        
        // Initialize Python generator if configured
        if (decodedConfig.python_script_url) {
            console.log('Initializing Python Generator Script from configuration');
            try {
                // Download the Python script if not already downloaded
                await PythonRunner.downloadScript(decodedConfig.python_script_url);
                
                // If an update interval is defined, set it
                if (decodedConfig.python_update_interval) {
                    console.log('Setting up automatic Python generator update');
                    PythonRunner.scheduleUpdate(decodedConfig.python_update_interval);
                }
            } catch (pythonError) {
                console.error('Error initializing Python script:', pythonError);
            }
        }
        
        res.send(renderConfigPage(protocol, host, decodedConfig, config.manifest));
    } catch (error) {
        console.error('Error in configuration:', error);
        res.redirect('/');
    }
});

// Route for manifest - supports both old and new system
app.get('/manifest.json', async (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const configUrl = `${protocol}://${host}/?${new URLSearchParams(req.query)}`;
        if (req.query.resolver_update_interval) {
            configUrl += `&resolver_update_interval=${encodeURIComponent(req.query.resolver_update_interval)}`;
        }
        if (req.query.m3u && CacheManager.cache.m3uUrl !== req.query.m3u) {
            await CacheManager.rebuildCache(req.query.m3u);
        }
        
        const { genres } = CacheManager.getCachedData();
        const manifestConfig = {
            ...config.manifest,
            catalogs: [{
                ...config.manifest.catalogs[0],
                extra: [
                    {
                        name: 'genre',
                        isRequired: false,
                        options: genres
                    },
                    {
                        name: 'search',
                        isRequired: false
                    },
                    {
                        name: 'skip',
                        isRequired: false
                    }
                ]
            }],
            behaviorHints: {
                configurable: true,
                configurationURL: configUrl,
                reloadRequired: true
            }
        };
        const builder = new addonBuilder(manifestConfig);
        
        if (req.query.epg_enabled === 'true') {
            // If no EPG URL was manually provided, use the one from the playlist
            const epgToUse = req.query.epg || 
                (CacheManager.getCachedData().epgUrls && 
                 CacheManager.getCachedData().epgUrls.length > 0 
                    ? CacheManager.getCachedData().epgUrls.join(',') 
                    : null);
          
            if (epgToUse) {
                await EPGManager.initializeEPG(epgToUse);
            }
        }
        builder.defineCatalogHandler(async (args) => catalogHandler({ ...args, config: req.query }));
        builder.defineStreamHandler(async (args) => streamHandler({ ...args, config: req.query }));
        builder.defineMetaHandler(async (args) => metaHandler({ ...args, config: req.query }));
        res.setHeader('Content-Type', 'application/json');
        res.send(builder.getInterface().manifest);
    } catch (error) {
        console.error('Error creating manifest:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// New route for manifest with encoded configuration
app.get('/:config/manifest.json', async (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));

        if (decodedConfig.m3u && CacheManager.cache.m3uUrl !== decodedConfig.m3u) {
            await CacheManager.rebuildCache(decodedConfig.m3u);
        }
        if (decodedConfig.resolver_script) {
            console.log('Initializing Resolver Script from configuration');
            try {
                // Download the Resolver script
                const resolverDownloaded = await PythonResolver.downloadScript(decodedConfig.resolver_script);
              
                // If an update interval is defined, set it
                if (decodedConfig.resolver_update_interval) {
                    console.log('Setting up automatic resolver update');
                    PythonResolver.scheduleUpdate(decodedConfig.resolver_update_interval);
                }
            } catch (resolverError) {
                console.error('Error initializing Resolver script:', resolverError);
            }
        }
        // Initialize Python generator if configured
        if (decodedConfig.python_script_url) {
            console.log('Initializing Python Generator Script from configuration');
            try {
                // Download the Python script if not already downloaded
                await PythonRunner.downloadScript(decodedConfig.python_script_url);
                
                // If an update interval is defined, set it
                if (decodedConfig.python_update_interval) {
                    console.log('Setting up automatic Python generator update');
                    PythonRunner.scheduleUpdate(decodedConfig.python_update_interval);
                }
            } catch (pythonError) {
                console.error('Error initializing Python script:', pythonError);
            }
        }

        const { genres } = CacheManager.getCachedData();
        const manifestConfig = {
            ...config.manifest,
            catalogs: [{
                ...config.manifest.catalogs[0],
                extra: [
                    {
                        name: 'genre',
                        isRequired: false,
                        options: genres
                    },
                    {
                        name: 'search',
                        isRequired: false
                    },
                    {
                        name: 'skip',
                        isRequired: false
                    }
                ]
            }],
            behaviorHints: {
                configurable: true,
                configurationURL: `${protocol}://${host}/${req.params.config}/configure`,
                reloadRequired: true
            }
        };

        const builder = new addonBuilder(manifestConfig);
        
        if (decodedConfig.epg_enabled === 'true') {
            // If no EPG URL was manually provided, use the one from the playlist
            const epgToUse = decodedConfig.epg || 
                (CacheManager.getCachedData().epgUrls && 
                 CacheManager.getCachedData().epgUrls.length > 0 
                    ? CacheManager.getCachedData().epgUrls.join(',') 
                    : null);
                    
            if (epgToUse) {
                await EPGManager.initializeEPG(epgToUse);
            }
        }
        
        builder.defineCatalogHandler(async (args) => catalogHandler({ ...args, config: decodedConfig }));
        builder.defineStreamHandler(async (args) => streamHandler({ ...args, config: decodedConfig }));
        builder.defineMetaHandler(async (args) => metaHandler({ ...args, config: decodedConfig }));
        
        res.setHeader('Content-Type', 'application/json');
        res.send(builder.getInterface().manifest);
    } catch (error) {
        console.error('Error creating manifest:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Maintain existing route for other endpoints
app.get('/:resource/:type/:id/:extra?.json', async (req, res, next) => {
    const { resource, type, id } = req.params;
    const extra = req.params.extra 
        ? safeParseExtra(req.params.extra) 
        : {};
    
    try {
        let result;
        switch (resource) {
            case 'stream':
                result = await streamHandler({ type, id, config: req.query });
                break;
            case 'catalog':
                result = await catalogHandler({ type, id, extra, config: req.query });
                break;
            case 'meta':
                result = await metaHandler({ type, id, config: req.query });
                break;
            default:
                next();
                return;
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        console.error('Error handling request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Route for downloading template
app.get('/api/resolver/download-template', (req, res) => {
    const PythonResolver = require('./python-resolver');
    const fs = require('fs');
    
    try {
        if (fs.existsSync(PythonResolver.scriptPath)) {
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', 'attachment; filename="resolver_script.py"');
            res.sendFile(PythonResolver.scriptPath);
        } else {
            res.status(404).json({ success: false, message: 'Template not found. Create it first with the "Create Template" function.' });
        }
    } catch (error) {
        console.error('Error downloading template:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

function cleanupTempFolder() {
    console.log('\n=== Cleaning temp folder on startup ===');
    const tempDir = path.join(__dirname, 'temp');
    
    // Check if temp folder exists
    if (!fs.existsSync(tempDir)) {
        console.log('Temp folder not found, creating it...');
        fs.mkdirSync(tempDir, { recursive: true });
        return;
    }
    
    try {
        // Read all files in temp folder
        const files = fs.readdirSync(tempDir);
        let deletedCount = 0;
        
        // Delete each file
        for (const file of files) {
            try {
                const filePath = path.join(tempDir, file);
                // Check if it's a file and not a folder
                if (fs.statSync(filePath).isFile()) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            } catch (fileError) {
                console.error(`❌ Error deleting file ${file}:`, fileError.message);
            }
        }
        
        console.log(`✓ Deleted ${deletedCount} temporary files`);
        console.log('=== Temp folder cleanup completed ===\n');
    } catch (error) {
        console.error('❌ Error cleaning temp folder:', error.message);
    }
}

function safeParseExtra(extraParam) {
    try {
        if (!extraParam) return {};
        
        const decodedExtra = decodeURIComponent(extraParam);
        
        // Support for skip with genre
        if (decodedExtra.includes('genre=') && decodedExtra.includes('&skip=')) {
            const parts = decodedExtra.split('&');
            const genre = parts.find(p => p.startsWith('genre=')).split('=')[1];
            const skip = parts.find(p => p.startsWith('skip=')).split('=')[1];
            
            return { 
                genre, 
                skip: parseInt(skip, 10) || 0 
            };
        }
        
        if (decodedExtra.startsWith('skip=')) {
            return { skip: parseInt(decodedExtra.split('=')[1], 10) || 0 };
        }
        
        if (decodedExtra.startsWith('genre=')) {
            return { genre: decodedExtra.split('=')[1] };
        }
        
        if (decodedExtra.startsWith('search=')) {
            return { search: decodedExtra.split('=')[1] };
        }
        
        try {
            return JSON.parse(decodedExtra);
        } catch {
            return {};
        }
    } catch (error) {
        console.error('Error parsing extra:', error);
        return {};
    }
}

// For catalog with encoded config
app.get('/:config/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        const extra = req.params.extra 
            ? safeParseExtra(req.params.extra) 
            : {};
        
        const result = await catalogHandler({ 
            type: req.params.type, 
            id: req.params.id, 
            extra, 
            config: decodedConfig 
        });
        
        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        console.error('Error handling catalog request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// For stream with encoded config
app.get('/:config/stream/:type/:id.json', async (req, res) => {
    try {
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        
        const result = await streamHandler({ 
            type: req.params.type, 
            id: req.params.id, 
            config: decodedConfig 
        });
        
        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        console.error('Error handling stream request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// For meta with encoded config
app.get('/:config/meta/:type/:id.json', async (req, res) => {
    try {
        const configString = Buffer.from(req.params.config, 'base64').toString();
        const decodedConfig = Object.fromEntries(new URLSearchParams(configString));
        
        const result = await metaHandler({ 
            type: req.params.type, 
            id: req.params.id, 
            config: decodedConfig 
        });
        
        res.setHeader('Content-Type', 'application/json');
        res.send(result);
    } catch (error) {
        console.error('Error handling meta request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Route to serve generated M3U file
app.get('/generated-m3u', (req, res) => {
    const m3uContent = PythonRunner.getM3UContent();
    if (m3uContent) {
        res.setHeader('Content-Type', 'text/plain');
        res.send(m3uContent);
    } else {
        res.status(404).send('M3U file not found. Run the Python script first.');
    }
});

app.post('/api/resolver', async (req, res) => {
    const { action, url, interval } = req.body;
    
    try {
        if (action === 'download' && url) {
            const success = await PythonResolver.downloadScript(url);
            if (success) {
                res.json({ success: true, message: 'Resolver script downloaded successfully' });
            } else {
                res.status(500).json({ success: false, message: PythonResolver.getStatus().lastError });
            }
        } else if (action === 'create-template') {
            const success = await PythonResolver.createScriptTemplate();
            if (success) {
                res.json({ 
                    success: true, 
                    message: 'Resolver script template created successfully',
                    scriptPath: PythonResolver.scriptPath
                });
            } else {
                res.status(500).json({ success: false, message: PythonResolver.getStatus().lastError });
            }
        } else if (action === 'check-health') {
            const isHealthy = await PythonResolver.checkScriptHealth();
            res.json({ 
                success: isHealthy, 
                message: isHealthy ? 'Resolver script is valid' : PythonResolver.getStatus().lastError 
            });
        } else if (action === 'status') {
            res.json(PythonResolver.getStatus());
        } else if (action === 'clear-cache') {
            PythonResolver.clearCache();
            res.json({ success: true, message: 'Resolver cache cleared' });
        } else if (action === 'schedule' && interval) {
            const success = PythonResolver.scheduleUpdate(interval);
            if (success) {
                res.json({ 
                    success: true, 
                    message: `Automatic update scheduled every ${interval}` 
                });
            } else {
                res.status(500).json({ success: false, message: PythonResolver.getStatus().lastError });
            }
        } else if (action === 'stopSchedule') {
            const stopped = PythonResolver.stopScheduledUpdates();
            res.json({ 
                success: true, 
                message: stopped ? 'Automatic update stopped' : 'No scheduled update to stop' 
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid action' });
        }
    } catch (error) {
        console.error('Resolver API Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/rebuild-cache', async (req, res) => {
    try {
        const m3uUrl = req.body.m3u;
        if (!m3uUrl) {
            return res.status(400).json({ success: false, message: 'M3U URL required' });
        }

        console.log('🔄 Cache rebuild request received');
        await CacheManager.rebuildCache(req.body.m3u, req.body);
        
        if (req.body.epg_enabled === 'true') {
            console.log('📡 Rebuilding EPG...');
            const epgToUse = req.body.epg || 
                (CacheManager.getCachedData().epgUrls && CacheManager.getCachedData().epgUrls.length > 0 
                    ? CacheManager.getCachedData().epgUrls.join(',') 
                    : null);
            if (epgToUse) {
                await EPGManager.initializeEPG(epgToUse);
            }
        }

        res.json({ success: true, message: 'Cache and EPG rebuilt successfully' });
       
    } catch (error) {
        console.error('Error rebuilding cache:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API endpoint for Python script operations
app.post('/api/python-script', async (req, res) => {
    const { action, url, interval } = req.body;
    
    try {
        if (action === 'download' && url) {
            const success = await PythonRunner.downloadScript(url);
            if (success) {
                res.json({ success: true, message: 'Script downloaded successfully' });
            } else {
                res.status(500).json({ success: false, message: PythonRunner.getStatus().lastError });
            }
        } else if (action === 'execute') {
            const success = await PythonRunner.executeScript();
            if (success) {
                res.json({ 
                    success: true, 
                    message: 'Script executed successfully', 
                    m3uUrl: `${req.protocol}://${req.get('host')}/generated-m3u` 
                });
            } else {
                res.status(500).json({ success: false, message: PythonRunner.getStatus().lastError });
            }
        } else if (action === 'status') {
            res.json(PythonRunner.getStatus());
        } else if (action === 'schedule' && interval) {
            const success = PythonRunner.scheduleUpdate(interval);
            if (success) {
                res.json({ 
                    success: true, 
                    message: `Automatic update scheduled every ${interval}` 
                });
            } else {
                res.status(500).json({ success: false, message: PythonRunner.getStatus().lastError });
            }
        } else if (action === 'stopSchedule') {
            const stopped = PythonRunner.stopScheduledUpdates();
            res.json({ 
                success: true, 
                message: stopped ? 'Automatic update stopped' : 'No scheduled update to stop' 
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid action' });
        }
    } catch (error) {
        console.error('Python API Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

async function startAddon() {
   cleanupTempFolder();

   try {
       const port = process.env.PORT || 10000;
       app.listen(port, () => {
          console.log('=============================\n');
          console.log('TRUE TV ADDON Started successfully');
          console.log('Visit the web page to generate the manifest configuration and install it on Stremio');
          console.log('Configuration page link:', `http://localhost:${port}`);
          console.log('=============================\n');
        });
   } catch (error) {
       console.error('Failed to start addon:', error);
       process.exit(1);
   }
}

startAddon();
