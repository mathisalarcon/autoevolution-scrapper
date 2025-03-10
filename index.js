const puppeteer = require("puppeteer-extra");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

const json = require("./data/cars.json");

puppeteer.use(StealthPlugin());

(async () => {
	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	});

	const page = await browser.newPage();
	await page.setUserAgent(
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, comme Gecko) Chrome/91.0.4472.124 Safari/537.36"
	);

	const url = "https://www.autoevolution.com/cars/";

    await page.goto(url, { waitUntil: "networkidle2" });
    
	var html = await page.content();

	var cars = [];
    const makes = getAllMakes(html);
	for (let make of makes) {
		if(!json[make.brand]) json[make.brand] = {};
    }
    
	var next = true;

	let select = makes.filter((make, i) => i >= makes.map((e) => e.brand).indexOf("VOLVO"));

	for (let make of select) {
		console.log("🚗 Marque:", make.brand);
		await page.goto(make.url, { waitUntil: "networkidle2" });
		var html1 = await page.content();
		const models = getAllModels(html1, make.brand);

		for (let model of models) {
			if(!json[make.brand][model.model]) json[make.brand][model.model] = [];
		}

		for (let model of models) {
			console.log("🚙 Modèle:", model.model);
			await page.goto(model.url, { waitUntil: "networkidle2" });
            var html2 = await page.content();
            let submodels = getAllSubModels(html2);

			// Only get submodels that are not already in the JSON
			submodels = submodels.filter((submodel) => {
				return !json[make.brand][model.model].some(
					(e) => e.year === submodel.year
				);
			});

			for (let submodel of submodels) {
				console.log("-> Sous-modèle:", submodel.year);
                await page.goto(submodel.url, { waitUntil: "networkidle2" });
                html2 = await page.content();
                const specs = await getSpecs(html2);
                json[make.brand][model.model].push({
                    year: submodel.year,
                    image: submodel.image,
                    specs: specs,
                });
                fs.writeFileSync(
                    path.join(__dirname, "data", "cars.json"),
                    JSON.stringify(json, null, 2)
                );
                console.log("✅", make.brand, model.model, submodel.year, specs);
            }
		}
	}
})();

function getAllMakes(html) {
	var $ = cheerio.load(html);

	const container = $(".container.carlist.clearfix");
	const elements = container.children(".col2width");

	let makes = [];
	for (let i = 0; i < elements.length; i++) {
		const element = elements[i];
		const brand = $(element).find("a").attr("title").trim();
		const url = $(element).find("a").attr("href").trim();

		makes.push({
			brand: brand,
			url: url,
		});
	}

	return makes;
}
function getAllModels(html, brand) {
	var $ = cheerio.load(html);

    const containers = $(".carmodels.col23width.clearfix");
    var models = [];
    
    for (let i = 0; i < containers.length; i++) {
        let container = $(containers[i]);
        const elements = container.children(".carmod.clearfix");

        for (let i = 0; i < elements.length; i++) {
            const element = $(elements[i]).children().first();
            const model = $(element)
                .find("a")
                .children("h4")
                .first()
                .text()
                .replace(brand, "")
                .trim();
            const url = $(element).find("a").attr("href").trim();

            models.push({
                model: model,
                url: url,
            });
        }
    }

	return models;
}

function getAllSubModels(html) {
    var $ = cheerio.load(html);

    const elements = $(".col23width.fl.bcol-white");

    let submodels = [];
    for (let i = 0; i < elements.length; i++) {
        const element = $(elements[i]);
        const extractStartYear = (text) => {
			// Regex pour capturer les années sous forme "YYYY", avec ou sans date de fin
			const regex =
				/\b(19\d{2}|20\d{2})\b\s*(?:-\s*\b(19\d{2}|20\d{2}|[A-Za-z]+)\b)?/g;
			const matches = [...text.matchAll(regex)]; // Récupère toutes les correspondances

			if (matches.length > 0) {
				for (const match of matches) {
					const startYear = parseInt(match[1]);

					// Vérification de la validité de l'année
					const currentYear = new Date().getFullYear();
					if (startYear >= 1900 && startYear <= currentYear + 5) {
						return startYear; // Retourne la première année valide trouvée
					}
				}
			}

			return null; // Retourne null si aucune année valide n'est trouvée
		};

        const year = extractStartYear(element.find(".years").text());
        // L'élément précédent contient l'image
        const image = element.prev(".col1width.fl").find("img").attr("src").trim();
        const url = element.find("a.txt.newstext.upcase.bold.sanscond.fsz17.mgbot_10.dispblock").attr("href").trim();

        submodels.push({
            year: year,
            image: image,
            url: url,
        });
    }

    return submodels;
}

async function getSpecs(html) {
	const $ = cheerio.load(html);

	let table = $(".techdata").children("tbody").children("tr");
	let cylinders = trFetcher($, $(".techdata"), "cylinders:");
	let displacement = trFetcher($, $(".techdata"), "displacement:")
		.split(" ")[0]
		.trim();
	// Pour le power, ne récupère que la partie ... HP, car il y a KW, HP, et BHP, séparés par des <br>, récupère les 3 valeurs à l'aide de regex
	const extractPowerSpecs = (text) => {
		const regex = /(\d+\.?\d*)\s*(KW|HP|BHP)/gi;
		const powerSpecs = {};

		let match;
		while ((match = regex.exec(text)) !== null) {
			const value = parseFloat(match[1]); // Convertir en nombre
			const unit = match[2].toLowerCase(); // Mettre en minuscule pour uniformiser les clés

			if (unit === "kw") powerSpecs.kw = value;
			if (unit === "hp") powerSpecs.hp = value;
			if (unit === "bhp") powerSpecs.bhp = value;
		}

		return powerSpecs;
	};
	let power = extractPowerSpecs(trFetcher($, $(".techdata"), "power:"));
	const extractTorqueSpecs = (text) => {
		const regex = /(\d+\.?\d*)\s*(lb-ft|Nm)/gi;
		const torqueSpecs = {};

		let match;
		while ((match = regex.exec(text)) !== null) {
			const value = parseFloat(match[1]); // Convertir en nombre
			const unit = match[2].toLowerCase(); // Mettre en minuscule pour uniformiser les clés

			if (unit === "lb-ft") torqueSpecs.lb_ft = value;
			if (unit === "nm") torqueSpecs.nm = value;
		}

		return torqueSpecs;
	};
	let torque = extractTorqueSpecs(trFetcher($, $(".techdata"), "torque:"));
	let fuel = trFetcher($, $(".techdata"), "fuel:");
    const extractLiters = (text) => {
		const regex = /(\d+\.?\d*)\s*L/gi; // Capture uniquement les litres
		const match = regex.exec(text);

		return match ? parseFloat(match[1]) : null; // Retourne uniquement la valeur en litres
	};
	let fuel_capacity = extractLiters(
		trFetcher($, $(".techdata"), "fuel capacity:")
	);

	// Le 2e tableau contient les informations de performance
	table = $(".techdata").eq(1).children("tbody").children("tr");
	const extractKmh = (text) => {
		const regex = /(\d+\.?\d*)\s*km\/h/gi; // Capture uniquement les km/h
		const match = regex.exec(text);

		return match ? parseFloat(match[1]) : null; // Retourne uniquement la valeur en km/h
	};
	let top_speed = extractKmh(trFetcher($, $(".techdata"), "top speed:"));
	let acceleration = trFetcher($, $(".techdata"), "Acceleration 0-62 Mph (0-100 kph):")?.split(" ")?.at(0)?.trim();

	// Le 3e tableau contient les informations de transmission
	table = $(".techdata").eq(2).children("tbody").children("tr");
	const extractDrivetrainAcronym = (text) => {
		const drivetrainMap = {
			"rear wheel drive": "RWD",
			"front wheel drive": "FWD",
			"all wheel drive": "AWD",
			"four wheel drive": "4WD",
			"part-time four wheel drive": "4WD",
			"full-time four wheel drive": "4WD",
		};

		// Convertir la chaîne en minuscule pour la comparaison
		const normalizedText = text.toLowerCase().trim();

		return drivetrainMap[normalizedText] || null; // Retourne l'acronyme ou null si non trouvé
	};
	let drivetrain = extractDrivetrainAcronym(
		trFetcher($, $(".techdata"), "Drive Type:")
	);

	// Le 8e tableau contient les informations de consommation
	table = $(".techdata").eq(7).children("tbody").children("tr");
	const extractL100km = (text) => {
		const regex = /(\d+\.?\d*)\s*L\/100Km/gi; // Capture uniquement les L/100Km
		const match = regex.exec(text);

		return match ? parseFloat(match[1]) : null; // Retourne uniquement la valeur en L/100Km
	};
	let fuel_economy = extractL100km(
		trFetcher($, $(".techdata"), "Combined:")
	);

	return {
		cylinders: cylinders,
		displacement: displacement,
		power: power,
		torque: torque,
		fuel: fuel,
		fuel_capacity: fuel_capacity,
		top_speed: top_speed,
		acceleration: acceleration,
		drivetrain: drivetrain,
		fuel_economy: fuel_economy,
	};
}

function trFetcher($, table, title) {
	return table
		.find("tr")
		.filter((i, el) => {
			return (
				$(el).find("td")?.first()?.text()?.trim()?.toLowerCase() ==
				title.toLowerCase()
			);
		})
		.find("td")
		?.last()
		?.text()
		?.trim();
}