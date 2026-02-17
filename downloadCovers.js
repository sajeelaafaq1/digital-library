import fs from "fs";
import path from "path";
import axios from "axios";

const coversDir = path.join(process.cwd(), "public/covers");
fs.mkdirSync(coversDir, { recursive: true });

const coverIds = [
  3770392,
  11278832,
  10526233,
  9278312,
  8745609,
  9330288,
  9641,
  12239364,
  8783246,
  10504047,
  10117751,
  212576,
  7434198,
  9637345,
  10195084,
  10125674,
  11408459,
  14553479,
  8396115,
  9322673,
  11013590,
  9255229,
  8373389,
  10722227,
  13512491,
  13828715,
  10527843,
  11172296,
  12996422,
  12855353,
  12858480,
  6672363,
  12539702,
  8836521,
  2127547,
  8843390,
  9306426,
  15150200,
  12646537,
  12646539,
  6304853,
  184094,
  10166964,
  10604874,
  190086,
  2086321,
  544947,
  8840485,
  6961692,
  6610123,
  13299222,
  9246429,
  8063264,
  6717853,
  2549777,
  12588989,
  4893219,
  6639667,
  418324,
  9323460,
  9889264,
  8260231,
  271730,
  271746,
  271730,
  9222248,
  7914168,
  8634250,
  8815165,
  2595800,
  260117,
  7106764,
  8579790,
  7258558,
  14846827,
  10389354,
  14369537,
  10192514,
  10139078,
  3990580,
  8216412,
  10187816,
  3344204,
  496856,
  12569842,
  10395276,
  45897,
  9184792,
  6529226,
  180603,
  8231751,
  8600709,
  11301264,
  6501256,
  9269962,
  11445498,
  12063529,
  10188063,
  8463957,
  540949,
  9369140,
  9267242,
  8122291,
  2411585,
  12848701,
  13921600,
  13921600,
  13841845,
  8784482,
  10278806,
  8463196,
  1954942,
  10352347,
  12690340,
  9324125,
  181641,
  6822606,
  10212046,
  8417016,
  15158664,
  15158660,
  12059372,
  10716273,
  15158666,
  15155833,
  10580435,
  8273320,
  13776199,
  26627,
  10741155,
  5561040,
  13226540,
  10487646,
  1056393,
  11208031,
  10322941,
  6476922,
  4672,
  1968395,
  430448,
  430162,
  6793646,
  6622362,
  9640110,
  288031,
  9416292,
  23402,
  14891629,
  12356249,
  1850997,
  213299,
  4967198,
  12176353,
  383658,
  12717083,
  6419199,
  6960817,
  8231846
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadCover(id) {
  const url = `https://covers.openlibrary.org/b/id/${id}-L.jpg`;
  const filePath = path.join(coversDir, `${id}-L.jpg`);

  if (fs.existsSync(filePath)) {
    console.log(`✔ Already exists: ${id}`);
    return;
  }

  console.log(`⬇ Downloading ${id}...`);

  const response = await axios.get(url, { responseType: "stream", timeout: 15000 });
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    response.data.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  console.log(`✅ Done: ${id}`);
}

(async () => {
  for (const id of coverIds) {
    try {
      await downloadCover(id);
    } catch (err) {
      console.error(`❌ Failed ${id}`, err.message);
    }

    console.log("⏳ Waiting 10 seconds...\n");
    await sleep(10_000);
  }

  console.log("🎉 All downloads finished");
})();
