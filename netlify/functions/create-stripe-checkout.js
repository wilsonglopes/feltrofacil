const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { items, customerEmail } = JSON.parse(event.body);
    
    // Conecta no Banco para pegar preços reais (Segurança)
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    const productIds = items.map(i => i.id);
    const { data: products } = await supabase.from('products').select('*').in('id', productIds);

    const line_items = items.map(item => {
      const dbProduct = products.find(p => p.id === item.id);
      if (!dbProduct) return null;
      
      return {
        price_data: {
          currency: 'brl', // Cobra em Reais (o cartão do cliente converte)
          product_data: {
            name: dbProduct.title,
            images: [dbProduct.cover_image],
            metadata: {
                product_id: dbProduct.id 
            }
          },
          unit_amount: Math.round(dbProduct.price * 100), // Stripe usa centavos
        },
        quantity: 1,
      };
    }).filter(i => i !== null);

    // Cria a sessão de pagamento
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: line_items,
      mode: 'payment',
      customer_email: customerEmail, // Já preenche o e-mail pro cliente
      success_url: 'https://loja.feltrofacil.com.br/sucesso.html', // Mude para seu domínio real se não for esse
      cancel_url: 'https://loja.feltrofacil.com.br/',
      metadata: {
        product_ids: productIds.join(','), // Guardamos os IDs para o Webhook ler depois
        customer_email: customerEmail
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ id: session.id, url: session.url })
    };

  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
