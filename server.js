require('dotenv').config();
const express = require('express');
const app = express();
const port = 'http://confort-env.eba-an3gpp3m.sa-east-1.elasticbeanstalk.com/';
const mysql = require('mysql2/promise');
const moment = require('moment');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
const keys = require('./credentials.json');

async function createFolder(drive, name, parentId) {
  // Lista todas as pastas no diretório pai
  const response = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  // Verifica se a pasta já existe
  const folder = response.data.files.find(file => file.name === name);

  // Se a pasta já existir, retorna o ID dela
  if (folder) {
    return folder.id;
  }

  // Caso contrário, cria uma nova pasta e retorna o ID dela
  const createResponse = await drive.files.create({
    requestBody: {
      name: name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : []
    },
    fields: 'id'
  });
  return createResponse.data.id;
}


async function exportSheetAsPDF(orderDate, clientName) {
  const client = new google.auth.JWT(
    keys.client_email,
    null,
    keys.private_key,
    ['https://www.googleapis.com/auth/drive']
    
  );

  await client.authorize();

  const drive = google.drive({ version: 'v3', auth: client });

  const year = orderDate.split('-')[0];
  const monthNames = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const month = monthNames[new Date(orderDate).getMonth()];

  const mainFolderId = '1HUBGjI_89LzU7IEXCtoedRm_7zgKr7jW';
  const yearFolderId = await createFolder(drive, year, mainFolderId);
  const monthFolderId = await createFolder(drive, month, yearFolderId);
  
  // Criando uma pasta com o nome do cliente dentro da pasta do mês
  const clientFolderId = await createFolder(drive, clientName, monthFolderId);

  const response = await drive.files.export({
    fileId: '1NI_1YlOcZg1AlbBCezOMc6dKYrRm3ic_D5o77U_FoRA', // Substitua pelo ID da sua planilha
    mimeType: 'application/pdf',
    request: {
      params: {
        exportFormat: 'pdf',
        scale: '1',
        printtitle: false,
        portrait: true,
        fitw: true,
        sheetnames: false,
        pagezise: 'A4'
      }
    }
  }, {responseType: 'stream'});
  

  const fileMetadata = {
    name: `${clientName}.pdf`,
    parents: [clientFolderId] // Aqui, usamos clientFolderId em vez de monthFolderId
  };

  const media = {
    mimeType: 'application/pdf',
    body: response.data
  };


  const file = await drive.files.create({
    requestBody: fileMetadata,
    media: media
  });
  console.log(file); // Adicione esta linha para logar a resposta
  const fileData = await drive.files.get({
    fileId: file.data.id,
    fields: 'webViewLink'
  });
  
  const pdfLink = fileData.data.webViewLink;
  console.log('PDF criado com sucesso');
  console.log(`PDF salvo em Planilha/${year}/${month}/${clientName}/${clientName}.pdf no Google Drive!`);
  return { fileId: file.data.id, drive }; // Retorne o webViewLink do arquivo criado e o drive
}


async function getSheetId(sheets) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId: '1NI_1YlOcZg1AlbBCezOMc6dKYrRm3ic_D5o77U_FoRA',
  });
  const sheet = response.data.sheets.find((s) => s.properties.title === 'Sheet1');
  return sheet.properties.sheetId;
}


async function updateRowHeight(sheets, rowNumber) {
  const sheetId = await getSheetId(sheets);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: '1NI_1YlOcZg1AlbBCezOMc6dKYrRm3ic_D5o77U_FoRA',
    resource: {
      requests: [
        {
          updateDimensionProperties: {
            range: {
              sheetId: sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            },
            properties: {
              pixelSize: 32
            },
            fields: 'pixelSize'
          }
        }
      ]
    }
  });
}
function splitOrderDetails(orderDetails) {
  return orderDetails.split('\n').map(detail => {
    const parts = detail.split(' ');
    const quantity = parts.shift(); // Primeiro número é a quantidade
    const price = parts.pop(); // Último número é o preço
    const product = parts.join(' '); // O restante é o nome do produto
    return { quantity, price, product };
  });
}



async function writeToGoogleSheets(data) {
  const client = new google.auth.JWT(
    keys.client_email,
    null,
    keys.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  await client.authorize();

  const sheets = google.sheets({ version: 'v4', auth: client });
   // Aqui, extraia apenas a parte da data (exclua a hora)
   const dateOnly = data.orderDate.split(' ')[0];
   const [year, month, day] = dateOnly.split('-');
   const formattedDate = `${day}/${month}/${year}`;


  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: '1NI_1YlOcZg1AlbBCezOMc6dKYrRm3ic_D5o77U_FoRA',
    resource: {
      data: [
        {
          range: 'Sheet1!A1',
          values: [[`Data:\n${formattedDate}`]]
        },
        {
          range: 'Sheet1!B2',
          values: [[data.clientName]]
        }
      ],
      valueInputOption: 'RAW'
    }
  });

  let currentRow = 8;
  for (const detail of data.orderDetails) {
    const { product, quantity, price } = detail;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: '1NI_1YlOcZg1AlbBCezOMc6dKYrRm3ic_D5o77U_FoRA',
      resource: {
        data: [
          {
            range: `Sheet1!A${currentRow}`,
            values: [[product]]
          },
          {
            range: `Sheet1!C${currentRow}`,
            values: [[quantity]]
          },
          {
            range: `Sheet1!D${currentRow}`,
            values: [[price]]
          },
          {
            range: `Sheet1!G${currentRow}`,
            values: [[`=${quantity}*${price}`]]
          }
        ],
        valueInputOption: 'USER_ENTERED'
      }
    });

    await updateRowHeight(sheets, currentRow);

    currentRow++;
    if (currentRow > 29) break;
  }
}


async function startServer() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true }
  });


  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/create-order', async (req, res) => {
    try {
      let { orderDate, clientName, orderDetails } = req.body;
  
      // Adicionando a hora atual à data do pedido
      orderDate = moment(orderDate, 'DD/MM/YYYY').set({
        hour: moment().hour(),
        minute: moment().minute(),
        second: moment().second()
      }).format('YYYY-MM-DD HH:mm:ss');
  
      const splitDetails = splitOrderDetails(orderDetails);
  
      // Primeiro, insira os detalhes do pedido sem o pdfLink
      for (const detail of splitDetails) {
        const { product, quantity, price } = detail;
        await connection.execute(
          'INSERT INTO pedidos (orderDate, clientName, produto, quantidade, preco) VALUES (?, ?, ?, ?, ?)',
          [orderDate, clientName, product, quantity, price]
        );
      }
  
      await writeToGoogleSheets({
        orderDate,
        clientName,
        orderDetails: splitDetails
      });
  
      // Agora, gere o pdfLink e o drive
      const { fileId, drive } = await exportSheetAsPDF(orderDate, clientName);
      const file = await drive.files.get({
        fileId: fileId,
        fields: 'webViewLink'
      });
      const pdfLink = file.data.webViewLink;

      console.log('Atualizando link do PDF no banco de dados'); // Adicione esta linha
      // Atualize o registro no banco de dados com o pdfLink
      await connection.execute(
        'UPDATE pedidos SET pdfLink = ? WHERE orderDate = ? AND clientName = ?',
        [pdfLink, orderDate, clientName]
      );

      res.send({ message: 'Pedido criado com sucesso!', pdfLink: pdfLink });
    } catch (error) {
      console.error("Erro ao criar pedido:", error);
      res.status(500).send('Erro ao criar pedido.');
    }
  });
  
  
  

  app.get('/', (req, res) => {
    res.send('Bem-vindo ao servidor!');
  });

  app.get('/order/:id', async (req, res) => {
    const orderId = req.params.id;
    const [rows] = await connection.execute('SELECT * FROM pedidos WHERE id = ?', [orderId]);
    res.json(rows[0]);
  });
  app.get('/orders', async (req, res) => {
    const [rows] = await connection.execute('SELECT * FROM pedidos');
    res.json(rows);
  });
  app.get('/orders-by-client-date', async (req, res) => {
    const { clientName, orderDate } = req.query;
    const [rows] = await connection.execute(
      'SELECT * FROM pedidos WHERE clientName = ? AND DATE(orderDate) = ? AND productionChecked = 1',
      [clientName, orderDate]
    );
    res.json(rows);
  });
  
  
  app.put('/order/:id', async (req, res) => {
    const orderId = req.params.id;
    const { orderDate, clientName, orderDetails, pdfLink, productionChecked, productionDate, deliveryChecked, deliveryDate } = req.body;
    await connection.execute(
      'UPDATE pedidos SET orderDate = ?, clientName = ?, orderDetails = ?, pdfLink = ?, productionChecked = ?, productionDate = ?, deliveryChecked = ?, deliveryDate = ? WHERE id = ?',
      [orderDate, clientName, orderDetails, pdfLink, productionChecked, productionDate, deliveryChecked, deliveryDate, orderId]
    );
    res.send('Pedido atualizado com sucesso!');
  });

    // Adicione esta nova rota no seu código
  app.put('/update-production/:id', async (req, res) => {
    const orderId = req.params.id;
    const { productionChecked, productionDate } = req.body;

    // Verifique se productionChecked está definido
    if (productionChecked === undefined) {
        return res.status(400).send('productionChecked é necessário.');
    }

    // Se productionDate não for fornecido, use null
    const date = productionDate || null;

    await connection.execute(
        'UPDATE pedidos SET productionChecked = ?, productionDate = ? WHERE id = ?',
        [productionChecked, date, orderId]
    );
    res.send('Pedido atualizado com sucesso!');
  });


  app.delete('/order/:id', async (req, res) => {
    const orderId = req.params.id;
    await connection.execute('DELETE FROM pedidos WHERE id = ?', [orderId]);
    res.send('Pedido excluído com sucesso!');
  });

  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Algo deu errado!');
  });

  app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
  });
}

startServer();
