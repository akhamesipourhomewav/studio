const express = require("express");
const fs = require("fs-extra");
const Handlebars = require("handlebars");
const path = require("path");
const crypto = require("crypto");
const readdir = require("recursive-readdir");
const sharp = require("sharp");
const tempy = require('tempy');

const app = express();

var games = [];
var staticURL = {};

async function init(){
	console.log("Loading static files");
	await loadStatic();
	
	console.log("Loading data files");
	await loadData();
	
	console.log("Listening");
	app.listen(process.env["M28N_SERVER_ID"] ? 80 : 8080);
}

var template = null;
function getTemplate(){
	if(process.env["DEBUG"]) template = null;
	if(template == null) template = Handlebars.compile(fs.readFileSync(__dirname + "/template.html", "utf8"));
	return template;
}

getTemplate(); // Force fetching template

async function loadStatic(){
	var dir = (__dirname + "/static/").replace(/\\/g, "/");
	var files = await readdir(dir);
	await Promise.all(files.map(async function(filename){
		filename = filename.replace(/\\/g, "/");
		
		if(filename.indexOf(dir) != 0) throw new Error("Assert error: '" + filename + "' doesn't start with '" + dir + "'");
		if(filename.split("/").pop()[0] == ".") return;
		
		var ext = path.extname(filename);
		var filepath = filename.slice(dir.length);
		var sha1 = await sha1File(filename);
		var baseURL = "/static/" + sha1;
		var urlFull = baseURL + ext;
		
		var staticObj = {
			src: urlFull,
			srcset: "",
		};
		
		staticURL[filepath] = staticObj;
		
		if(ext == ".png" || ext == ".jpg"){
			var sets = [
				{ suffix: "/1200", width: 1200 },
				{ suffix: "/800", width: 800 },
				{ suffix: "/400", width: 400, isDefault: true },
			];
			
			await Promise.all(sets.map(async function(set){
				var url = baseURL + set.suffix + ext;
				
				if(set.isDefault){
					staticObj.src = url;
				}
				
				if(staticObj.srcset != ""){
					staticObj.srcset += ", ";
				}
				
				staticObj.srcset += url + " " + set.width + "w";
				
				set.height = set.height || ((set.width * 2 / 3)|0);
				
				var tmpFilename = tempy.file({ extension: ext });
				
				var buf = await sharp(filename).resize(set.width, set.height).toFile(tmpFilename);
				app.get(url, function(req, res){
					res.sendFile(tmpFilename);
				});
			}));
		}else{
			app.get(urlFull, function(req, res){
				res.sendFile(filename);
			});
		}
	}));
}

async function loadData(){
	var files = await readdir(__dirname + "/data/");
	
	await Promise.all(files.map(async function(filename){
		filename = filename.replace(/\\/g, "/");
		
		if(filename.split(".").pop() != "json") return;
		
		var obj = await fs.readJson(filename);
		
		if(obj.disabled) return;
		
		if(obj.image){
			if(!staticURL.hasOwnProperty(obj.image)) throw new Error("Image not found: " + obj.image);
			obj.imageSrc = staticURL[obj.image].src;
			obj.imageSrcset = staticURL[obj.image].srcset;
		}
		
		games.push(obj);
	}));
}

app.get("/", simpleHandler(async function(req){
	var cardClasses = [
		"card-1",
		"card-2",
		"card-3",
		"card-4",
	];
	
	var btnClasses = [
		"btn-primary",
		"btn-success",
		"btn-warning",
		"btn-danger",
	];
	
	games.forEach(function(game, i){
		var bonus = 1.0;
		
		if(game.hasLinkBack) bonus += 0.3;
		
		game.sortOrder = Math.pow(Math.random(), bonus);
		
		game.cardClass = cardClasses[i % cardClasses.length];
		game.btnClass = btnClasses[i % btnClasses.length];
		if(game.firstParty) game.cardClass += " m28-first-party";
	});
	
	games.sort(function(a, b){
		return a.sortOrder - b.sortOrder;
	})
	
	return getTemplate()({
		games: games,
	});
}));

async function sha1File(filename){
	var generator = crypto.createHash("sha1");
	// FIXME: use pipes instead, if some images don"t fit in memory
	generator.update(await fs.readFile(filename, "binary"));
	return generator.digest("hex");
}

function simpleHandler(fn){
	return function(req, res){
		var p = fn(req);
		
		p.then(function(reply){
			res.send(reply);
		}).catch(function(err){
			console.error(err);
			res.status(500).send("Internal error");
		});
	}
}

init().catch(function(err){
	console.error(err);
	process.exit(1);
});
