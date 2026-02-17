import express from "express";
import cors from "cors";
import path from "path";

import book from "./routes/book.js";
import sort from "./routes/sort.js";
import organize from "./routes/organize.js"
import author from "./routes/author.js";
import rack from "./routes/rack.js";
import shelf from "./routes/shelf.js";
import libraryView from "./routes/libraryView.js";

const app = express();
app.use(cors());

const FILE_PATH = "./data.txt";


app.use(express.static(path.join(import.meta.dirname, 'public')));
app.use("/covers", express.static(path.join(process.cwd(), "public/covers")));

app.use(express.json());
app.use("/book", book);
app.use("/sort", sort);
app.use("/organize", organize);
app.use("/author", author);
app.use("/rack", rack);
app.use("/shelf", shelf);
app.use("/library-view", libraryView);


app.listen(2288, () => {
  console.log("Server running on http://localhost:2288");
});
