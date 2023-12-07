# urbit-webhook

## NOTE: This is a work in progress. It is not yet functional.

A simple webhook server for Urbit. It listens for POST requests on `/webhook`, then sends a poke to a Groups channel.

## Running

1. Run `npm install` to install dependencies.

2. On Urbit, create a Group with a chat channel. Note the flag of the chat channel. Alteratively, you can use an existing chat channel you have write access to.

3. Create a .env file with your Urbit credentials and the flag of the channel you wish to post to. For example:

```
URBIT_URL = http://localhost
URBIT_SHIP = zod
URBIT_CODE = lidlut-tabwed-pillex-ridrup
URBIT_NEST = chat/~zod/hi
```

4. Run `node server.js` to start the server.
