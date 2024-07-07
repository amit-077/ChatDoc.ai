const PDFParser = require("pdf-parse");//
const { DataAPIClient } = require("@datastax/astra-db-ts");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
const express = require("express");
var random = require("random-name");
const app = express();

app.use(express.json());

dotenv.config();

const fs = require("fs");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "embedding-001" });
const model1 = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN);
const db = client.db(process.env.ASTRA_DB_API_ENDPOINT, {
  namespace: process.env.ASTRA_DB_NAMESPACE,
});

const createCollection = async (chunks) => {
  try {
    const name = random.first() + random.last();
    await db.createCollection(name, {
      vector: {
        dimension: 768,
      },
    });

    console.log("Collection created ...");
    console.log("Adding data to collection...");
    loadDataInDB(name, chunks);
  } catch (e) {
    console.log(e);
  }
};

const loadDataInDB = async (dbName, chunks) => {
  try {
    const collection = await db.collection(dbName);

    for (const chunk of chunks) {
      const result = await model.embedContent(chunk.data);

      const res = await collection.insertOne({
        document_id: chunk.id,
        $vector: result.embedding.values,
        description: chunk.data,
      });
    }

    console.log(`Data added successfully to collection ${dbName}`);
  } catch (e) {
    console.log(e);
  }
};

const getPDF = async () => {
  try {
    const dataBuffer = fs.readFileSync("./System_Design_Book.pdf");
    const pdfText = await PDFParser(dataBuffer);
    console.log("Below is the text");
    let cleanedText = pdfText.text
      .replace(/\s+/g, " ")
      .replace(/\n+/g, "\n")
      .replace(/[^\x00-\x7F]+/g, "")
      .trim();

    const chunkSize = 1000;
    const words = cleanedText.split(" ");
    let chunks = [];
    let currentChunk = "";
    let id = 1;

    for (let word of words) {
      if ((currentChunk + word + " ").length <= chunkSize) {
        currentChunk += word + " ";
      } else {
        chunks.push({
          id: id++,
          data: currentChunk.trim(),
        });
        currentChunk = word + " ";
      }
    }

    if (currentChunk.trim() !== "") {
      chunks.push({
        id: id++,
        data: currentChunk.trim(),
      });
    }

    console.log("Chunks created ...");
    console.log("Creating Collection");
    createCollection(chunks);
  } catch (e) {
    console.log(e);
  }
};

const runCode = async () => {
  // await getPDF();
  await db.dropCollection()
};

// runCode();

// --------------------------------------------  EXPRESS SERVER  -------------------------------------------------------

app.listen(8000, () => {
  console.log("Server listening on port 8000");
});

app.post("/message", async (req, res) => {
  try {
    let docContext = "";

    let { message } = req.body;
    console.log(message);
    const result = await model.embedContent(message);

    const collection = db.collection("LeslieMatusow");

    const cursor = collection.find(null, {
      sort: {
        $vector: result.embedding.values,
      },
      limit: 5,
    });

    const documents = await cursor.toArray();

    docContext = `
    START CONTEXT
    ${documents?.map((doc) => doc.description).join("\n")}
    END CONTEXT
    `;

    const outputResult = await model1.generateContent(`
        Act as a AI bot that will give answers based on the context provided to you. Make sure that you only answer the questions
        that are related to the context. If any question is asked out of the context, then simply respond as "I am sorry, I don't know the answer".
        You are allowed to elaborate or simplify the data of the context, but not change its meaning. Below is the given context.
        ${docContext}
        If the user asks you to explain or summarize, you can do that, but if it is out of context, simply respond as "I am sorry, I don't know the answer".
        And don't mention about the context in the answer. Only use the context data to answer the questions. The context will contain many data, but you have to just
        answer according to the question and appropriately, and not reply with the entire context data. Try to answer relevant according to the question. Do not use any kind
        of markdown syntax while answering.
        Now let's start. Below is the first question. 
        ${message}
        `);

    console.log(outputResult.response.text());
    res.send(outputResult.response.text());
  } catch (e) {
    console.log(e);
  }
});
