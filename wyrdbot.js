const Discord = require("discord.js");
const bot = new Discord.Client();
const { prefix, token } = require('./auth.json');
const deck = require("card-deck");
const ping = require("./ping.js");

bot.on('ready', function () {
	console.log("In Malefaux bad things happen!");
});

let players = [];
let ids = []

const player = function(id, twistDeck, twistDiscard, controlHand){
    this.id = id;
    this.twistDeck = twistDeck;
    this.twistDiscard = twistDiscard;
    this.controlHand = controlHand;
    ids.push(id);
};

//set up main deck 
let mainDeck = new deck([{rank: '1', suit: 'Rams'},
{rank: '1', suit: 'Crows'},
{rank: '1', suit: 'Tomes'},
{rank: '1', suit: 'Masks'},
{rank: '2', suit: 'Rams'},
{rank: '2', suit: 'Crows'},
{rank: '2', suit: 'Tomes'},
{rank: '2', suit: 'Masks'},
{rank: '3', suit: 'Rams'},
{rank: '3', suit: 'Crows'},
{rank: '3', suit: 'Tomes'},
{rank: '3', suit: 'Masks'},
{rank: '4', suit: 'Rams'},
{rank: '4', suit: 'Crows'},
{rank: '4', suit: 'Tomes'},
{rank: '4', suit: 'Masks'},
{rank: '5', suit: 'Rams'},
{rank: '5', suit: 'Crows'},
{rank: '5', suit: 'Tomes'},
{rank: '5', suit: 'Masks'},
{rank: '6', suit: 'Rams'},
{rank: '6', suit: 'Crows'},
{rank: '6', suit: 'Tomes'},
{rank: '6', suit: 'Masks'},
{rank: '7', suit: 'Rams'},
{rank: '7', suit: 'Crows'},
{rank: '7', suit: 'Tomes'},
{rank: '7', suit: 'Masks'},
{rank: '8', suit: 'Rams'},
{rank: '8', suit: 'Crows'},
{rank: '8', suit: 'Tomes'},
{rank: '8', suit: 'Masks'},
{rank: '9', suit: 'Rams'},
{rank: '9', suit: 'Crows'},
{rank: '9', suit: 'Tomes'},
{rank: '9', suit: 'Masks'},
{rank: '10', suit: 'Rams'},
{rank: '10', suit: 'Crows'},
{rank: '10', suit: 'Tomes'},
{rank: '10', suit: 'Masks'},
{rank: '11', suit: 'Rams'},
{rank: '11', suit: 'Crows'},
{rank: '11', suit: 'Tomes'},
{rank: '11', suit: 'Masks'},
{rank: '12', suit: 'Rams'},
{rank: '12', suit: 'Crows'},
{rank: '12', suit: 'Tomes'},
{rank: '12', suit: 'Masks'},
{rank: '13', suit: 'Rams'},
{rank: '13', suit: 'Crows'},
{rank: '13', suit: 'Tomes'},
{rank: '13', suit: 'Masks'},
{rank: 'Blackest', suit: 'Jokers'},
{rank: 'Reddest', suit: 'Jokers'}]);

//set up empty discard deck
let discard = new deck();
discard.cards([]);

function deckShuffle() {
	
	var discardCount = discard.remaining(); 
	var drawnCards = discard.draw(discardCount);			

	for(let card of drawnCards){
	  console.log(card);
	  mainDeck.addToTop(card);
	}

	mainDeck.shuffle();

	return true;
};

function shuffleTheDecks(target, source) {

	var discardCount = source.remaining(); 
	var drawnCards = source.draw(discardCount);			

	for(let card of drawnCards){
	  console.log(card);
	  target.addToTop(card);
	}

	target.shuffle();

	return true;
}

function camelize(str) {
  return str.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function(match, index) {
    if (+match === 0) return ""; // or if (/\s+/.test(match)) for white spaces
    return index === 0 ? match.toLowerCase() : match.toUpperCase();
  });
}

function testDeck(target, message) {

			reply = "";

			for(let ugg of players){
					if (message.author.id == ugg.id) {

						let twistDeck = ugg.twistDeck;
						let twistDiscard = ugg.twistDiscard;
						let controlHand = ugg.controlHand;


						switch(target) {

							case "twistDeck":
								for(let twistCard of twistDeck){
								  reply = reply +  twistCard.rank + ' of ' + twistCard.suit + '\n';
								}

							break;

							case "twistDiscard":
								for(let twistCard of twistDiscard){
								  reply = reply +  twistCard.rank + ' of ' + twistCard.suit + '\n';
								}

							break;

							case "controlHand":
								for(let twistCard of controlHand){
								  reply = reply +  twistCard.rank + ' of ' + twistCard.suit + '\n';
								}

							break;

							default:
								for(let twistCard of mainDeck){
								  reply = reply +  twistCard.rank + ' of ' + twistCard.suit + '\n';
								}

						}
					}
				}

		return message.channel.send(reply);

}


bot.on("message", (message) => {


	if (!message.content.startsWith(prefix) || message.author.bot) return;

		const args = message.content.slice(prefix.length).split(' ');
		const command = args.shift().toLowerCase();

		console.log ("command = " + command);
	
		switch(command) {
        	case 'ping':
        		// sends a test message 
	            ping(message);
            break;

            case 'start':
             	// starts the game with a new main deck
             	// and shuffles the deck
             	mainDeck.shuffle();
             	message.channel.send(`Card shuffled, and remember in Malefaux bad things happen!`);
			break;

			case 'flip':
				// this flips a card from the main fate deck
				var reply ="";

				//check to see if there are enough cards
				var cardCount = mainDeck.remaining(); 
				console.log("cards left = "+ cardCount)

					if (args[0] <= cardCount) {

						var drawnCards = mainDeck.draw(args[0]);

						for(let card of drawnCards){
						  console.log(card);
						  discard.addToTop(card);
						  reply = reply +  card.rank + ' of ' + card.suit + '\n';
						}

						var discardCount = discard.remaining(); 
						console.log("discard pile = "+ discardCount)

						return message.channel.send(reply);
					}

					var drawnCards = mainDeck.draw(cardCount);			

					for(let card of drawnCards){
					  console.log(card);
					  discard.addToTop(card);
					  reply = reply +  card.rank + ' of ' + card.suit + '\n';
					}

					var discardCount = discard.remaining(); 
					console.log("discard pile = "+ discardCount)

					// reshuffle the deck
					var response = deckShuffle();

					var neededCards = args[0] - cardCount

					reply = reply + '\n Not enough cards, still need to **!flip ' + neededCards + ' **';

					return message.channel.send(reply);

            break;

            case 'reshuffle':
            	//resuffles the main deck
            	//get the discard deck and put them back in the main deck and shuffle. 

            	var response = deckShuffle();
				if(response) {
					return message.channel.send(`Already?...Ugh...\nWyrdBot does the deck thing *shuffles*\n @everyone draw a card`);
            	}
            	return message.channel.send(`nothing to reshuffle with`);
            	
            break;
		

            case 'createdeck':
            	// create the users twist deck, 

            	let userID = message.author.id;

				let defining = 'Rams';
				let	ascendant = 'Masks';
				let	center = 'Crows';
				let	descendant = 'Tomes';

				// args
            	// set deafult 
            	console.log('args = ' + args);
				if (args[0]) {defining = args[0].toUpperCase()};
				if (args[1]) {ascendant = args[1].toUpperCase()};
				if (args[2]) {center = args[2].toUpperCase()};
				if (args[3]) {descendant = args[3].toUpperCase()};		

				// add cards to twist deck 
				let tempTwistDeck = new deck([
					{rank: '13', suit: defining},
					{rank: '9', suit: defining},
					{rank: '5', suit: defining},
					{rank: '1', suit: defining},

					{rank: '12', suit: ascendant},
					{rank: '8', suit: ascendant},
					{rank: '4', suit: ascendant},

					{rank: '11', suit: center},
					{rank: '7', suit: center},
					{rank: '3', suit: center},

					{rank: '10', suit: descendant},
					{rank: '6', suit: descendant},
					{rank: '2', suit: descendant}
					]);

				let tempTwistDiscard = new deck([]);
				let tempHand = new deck([]);

				tempTwistDeck.shuffle();

            	players.push(new player(userID,tempTwistDeck,tempTwistDiscard,tempHand));

            	console.log('players = ' + players);
            	console.log('ids = ' + ids);

            	var twistCount = tempTwistDeck.remaining(); 
				console.log("tempTwistDeck pile = "+ twistCount);

            	return message.channel.send(`player created`);

			break;

			case 'test':

				testDeck(args[0], message);
				
			break;

			case 'twistshuffle':
            	// twist deck is reshuffled. 
            	reply = "";

				for(let ugg of players){
					 console.log("ugg = " + ugg);

				  reply ='Shuffling twist discard pile into twist deck \n'

				  if (message.author.id == ugg.id) {

				  		// count how many cards are in the twist discard pile
						var discardCount = ugg.twistDiscard.remaining(); 
						 console.log("discardCount = " + discardCount);

						 // draw those cards
						var drawnCards = ugg.twistDiscard.draw(discardCount);	
						 console.log("drawnCards = " + drawnCards);		

						 // check to see that there are cards in the discard pile. 
						 if(drawnCards) {

						 	//put the discard cards back in the twist deck
							for(let card of drawnCards){
							  console.log(card);
							  ugg.twistDeck.addToTop(card);
							}
						 }

						 // shuffle the twist deck. 
						ugg.twistDeck.shuffle();

						reply = reply + "done"
										  	
					}					
				}

				return message.channel.send(reply);



            break;

			case 'draw':
				// this draws a card from your twist deck

				reply = "";

				for(let ugg of players){
					if (message.author.id == ugg.id) {
						// todo

						let twistDeck = ugg.twistDeck;
						let twistDiscard = ugg.twistDiscard;
						let controlHand = ugg.controlHand;

						for (var i = 0; i < args[0]; i++) {
							console.log("I = "+ i + " args = " + args[0]);

							var cardCount = twistDeck.remaining(); 
							console.log("cards left = "+ cardCount);

							// if there are no cards in your deck, shuffle the twist discard pile in
							if (cardCount==0) {
								shuffleTheDecks(twistDeck, twistDiscard);
							}

							// draw 1 cards from your twist deck
							var drawnCard = twistDeck.draw(1);
							console.log("drawnCard = " + drawnCard);
							controlHand.addToTop(drawnCard);
							reply = reply +  drawnCard.rank + ' of ' + drawnCard.suit + '\n';											

						}

					// and draw what is left to draw
					return message.channel.send(reply);
					}

				return true;
				}


            break;

			case 'hand':
            	// show hand
            break;

            case 'cheat':
           		// cheat a card
            break;

            case 'discard':
           		// drop a card from your hand
           		switch(arg[0]){
           			case 'all':

	           			for(let ugg of players){
							if (message.author.id == ugg.id) {

								let twistDeck = ugg.twistDeck;
								let twistDiscard = ugg.twistDiscard;
								let controlHand = ugg.controlHand;

								shuffleTheDecks(twistDiscard, controlHand);

								message.author.send(`Discarding all your hand`);

							}
						}

           			
           			break;
           		default:
           		}

            break;
            
			case 'server':
            	message.channel.send(`This server's name is: ${message.guild.name}`);
            break;

			case 'user':
            	message.author.send(`Your username: ${message.author.username}\nYour ID: ${message.author.id}`);
            break;

            case 'help': 
            	message.author.send('**We have the following commands:**\n' +
						'**!createDeck** = creates the users twist deck, \n\tformat: *!createTwistDeck Defining Ascendant Center Descendant* \n\tFor example *!createTwistDeck rams crows masks tomes* .\n\n' +
						'**!flip** = this flips a card from the main fate deck\n\tUse: *!flip* or *!flip x* ,where x is the number of cards.\n\n' + 
						'**!draw** = his draws a card from your twist deck\n\tUse: *!draw* or *!draw x* where x is the number of cards.\n\n' +
						'**!hand** = show the users current hand.\n\n' +					
						'**!shuffle** = shuffles the discard pile back into the main deck.\n\n' +
						'**!reshuffle** = reshuffles the deck and lets everyone know to draw a card.\n\n'+
						'**!twistShuffle** = twist deck is reshuffled.\n\n' +
						'**!cheat** = allows you to select a card from your hand and cheat fate.\n\n' +
						'**!ping** = sends a message to the bot, and the bot returns Pong\n\n' + 
						'**!help** = this command');

                message.channel.send(`The bonfires of Wyrdbot have been lit! **${message.author.username}** calls for aid!`);
				
            break;


            default:
            // Default message when we don't know what to say. 
            	 message.channel.send(`Care to try something different **${message.author.username}**, perhaps !help ?`);
         
        }
});

bot.login(token);


