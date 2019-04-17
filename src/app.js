const express = require('express');
const busboy = require('connect-busboy');
const querystring = require('querystring');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const rclone = require('./rclone');
const browserService = require('./services/browser');
const authService = require('./services/auth');
const authMiddleware = require('./middlewares/auth');

const app = express();
app.use(
    busboy({
        highWaterMark: 2 * 1024 * 1024, // Set 2MiB buffer
    }),
);
app.use(session({
    secret: 'keyboard cat',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: true,
        maxAge: 3600 * 1000,
    },
}));
app.use(bodyParser.urlencoded({ extended: false }));
app.use('/asset', express.static('asset'));
app.set('view engine', 'ejs');
app.set('views', './src/views');

app.use(authMiddleware);

app.get('/', (req, res) => {
    res.redirect('/browser/');
});

app.get('/login', (req, res) => {
    res.render('login', { page: 'Login - RClone Drive' });
});

app.get('/browser*', async (req, res) => {
    authService.checkLogin(req, res);
    const queryPath = Object.keys(querystring.decode(req.path))[0];
    const directory = queryPath.substr(8);
    const result = await browserService.ls(directory);
    res.render('browser', result);
});

app.get('/download*', async (req, res) => {
    const queryPath = Object.keys(querystring.decode(req.path))[0];
    const directory = queryPath.substr(9);
    rclone.cat(directory, res);
});

app.post('/browser*', (req, res) => {
    const directory = Object.keys(querystring.decode(req.path))[0].substr(8);
    req.pipe(req.busboy); // Pipe it trough busboy
    req.busboy.on('file', async (fieldname, file, filename) => {
        await rclone.rcat(path.join(directory, filename), file);
        // Wait for rclone to refresh (1s)
        await new Promise((r) => setTimeout(r, 1000));
        const result = await browserService.ls(directory);
        res.render('browser', { ...result, uploaded: true });
    });
});

app.post('/delete', async (req, res) => {
    const { path: filePath, isDir } = req.query;
    if (isDir) {
        await rclone.purge(filePath);
    } else {
        await rclone.deletefile(filePath);
    }
    res.redirect(`/browser${path.dirname(filePath)}`);
});

app.post('/mkdir', async (req, res) => {
    const { path: dir } = req.query;
    const { folder } = req.body;
    // RClone can't create empty dir, (https://github.com/ncw/rclone/issues/1837)
    // so just navigate to target dir, after upload any file, the dir will automaticly created.
    // await rclone.mkdir(path.join(dir, folder));
    res.redirect(path.join('/browser', dir, folder));
});

module.exports = app;
