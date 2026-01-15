// netlify/functions/process-payment.js
const { MercadoPagoConfig, Payment } = require('mercadopago');

exports.handler = async function(event, context) {
  // Cabeçalhos para permitir o acesso do site
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Validação
    if (!process.env.MP_ACCESS_TOKEN) throw new Error('MP_ACCESS_TOKEN ausente.');

    // Configuração
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    // Recebe os dados do formulário do frontend
    const body = JSON.parse(event.body);

    // Cria o pagamento
    // O Mercado Pago Brick já manda o JSON prontinho no formato certo
    const response = await payment.create({ body });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Erro ao processar pagamento:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Erro no processamento' }),
    };
  }
};
