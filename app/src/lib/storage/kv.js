import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { STATUS } from "../lobby/properties.js";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: awsCredentialsProvider({
        roleArn: process.env.AWS_ROLE_ARN
    }),
}));
const PK = "LOBBYID";
const PK_EXISTS_CONDITION = "attribute_exists(#pk)";
const PK_EXPRESSION_NAME = {"#pk": PK};
const ERROR_NAME = "ConditionalCheckFailedException";

export async function create (id, data) {
    try {
        return await docClient.send(new PutCommand({
            TableName: process.env.AWS_DB,
            Item: { [PK]: id, ...(data || {}) },
            ConditionExpression: "attribute_not_exists(#pk)",
            ExpressionAttributeNames: PK_EXPRESSION_NAME
        }));
    } catch (error) {
        if (error.name === ERROR_NAME) return null;
        else throw error;
    }
}

export async function get (id, ...keys) {
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConsistentRead: false,
    };
    if (keys?.length) {
        let i = 0;
        let attributes = {};
        const expressions = [];
        for (const key of keys) {
            const { names, expression } = parseNestedKey(key, i);
            if (expression) {
                expressions.push(expression);
                attributes = {...attributes, ...names};
            }
            i++;
        }
        if (expressions.length) {
            command.ProjectionExpression = expressions.join(", ");
            command.ExpressionAttributeNames = attributes;
        }
    }
    const response = await docClient.send(new GetCommand(command));
    return response?.Item;
}

export async function set (id, ...kwargs) {
    if (kwargs.length % 2 !== 0)
        throw new Error("Missing value for key parameter: ", kwargs?.at?.(-1));
    try {
        let names = {};
        const values = {};
        const expressions = [];
        for (let i = 0; i < kwargs.length; i += 2) {
            const { names: n, expression } = parseNestedKey(kwargs[i], i / 2);
            const value = kwargs[i+1];
            const idx = i / 2;
            names = {...names, ...n};
            values[`:val${idx}`] = value;
            expressions.push(expression);
        }
        const expression = "SET " + expressions.map((e, i) => `${e} = :val${i}`).join(", ");
        const command = {
            TableName: process.env.AWS_DB,
            Key: { [PK]: id },
            UpdateExpression: expression,
            ConditionExpression: PK_EXISTS_CONDITION, 
            ExpressionAttributeNames: {...names, ...PK_EXPRESSION_NAME},
            ExpressionAttributeValues: values
        };
        return await docClient.send(new UpdateCommand(command));
    } catch (error) {
        if (error.name === ERROR_NAME) return null;
        else throw error;
    }
}

export async function update (id, ...kwargs) {
    if (kwargs.length % 2 !== 0)
        throw new Error("Missing value for key parameter: ", kwargs?.at?.(-1));
    try {
        let names = {};
        const values = {};
        const expressions = [];
        for (let i = 0; i < kwargs.length; i += 2) {
            const { names: n, expression } = parseNestedKey(kwargs[i], i / 2);
            const value = kwargs[i+1];
            const idx = i / 2;
            names = {...names, ...n};
            values[`:val${idx}`] = value;
            expressions.push(expression);
        }
        const expression = "SET " + expressions.map((e, i) => `${e} = :val${i}`);
        const condition = PK_EXISTS_CONDITION
            + " AND "
            + expressions.map((e) => `attribute_exists(${e})`).join(" AND ");
        const command = {
            TableName: process.env.AWS_DB,
            Key: { [PK]: id },
            UpdateExpression: expression,
            ConditionExpression: condition, 
            ExpressionAttributeNames: {...names, ...PK_EXPRESSION_NAME},
            ExpressionAttributeValues: values
        };
        return await docClient.send(new UpdateCommand(command));
    } catch (error) {
        if (error.name === ERROR_NAME) return null;
        else throw error;
    }
}

export async function push (id, key, value) {
    try {
        return await docClient.send(new UpdateCommand({
            TableName: process.env.AWS_DB,
            Key: { [PK]: id },
            UpdateExpression: "SET #attr = list_append(if_not_exists(#attr, :empty), :value)",
            ConditionExpression: PK_EXISTS_CONDITION,
            ExpressionAttributeNames: { 
                "#attr": key,
                ...PK_EXPRESSION_NAME
            },
            ExpressionAttributeValues: {
                ":value": [value],
                ":empty": []
            }
        }));
    } catch (error) {
        if (error.name === ERROR_NAME) return null;
        else throw error;
    }
}

export async function remove (id) {
    try {
        return await docClient.send(new DeleteCommand({
            TableName: process.env.AWS_DB,
            Key: { [PK]: id },
            ConditionExpression: "attribute_exists(#pk)",
            ExpressionAttributeNames: PK_EXPRESSION_NAME
        }));
    } catch (error) {
        if (error.name === ERROR_NAME) return null;
        else throw error;
    }
}

export async function exists (id, key = ".") {
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConsistentRead: false
    };
    const { names, expression, keys } = parseNestedKey(key);
    if (expression) {
        command.ProjectionExpression = expression;
        command.ExpressionAttributeNames = names;
    }
    const response = await docClient.send(new GetCommand(command));
    const compare = expression
        // recurse through the returned item
        ? keys.reduce((acc, curr) =>
            acc && acc[curr] !== undefined ? acc[curr] : undefined,
            response.Item)
        : response.Item;
    return compare !== undefined;
}

export async function limitPush (id, limitColumn, key, value) {
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConditionExpression: "attribute_exists(#pk) AND size(#list) < #maxLimit",
        UpdateExpression: "SET #list = list_append(#list, :item), #count = #count + :inc",
        ExpressionAttributeNames: {
            "#list": key,
            "#maxLimit": limitColumn,
            "#count": "itemCount",
            ...PK_EXPRESSION_NAME
        },
        ExpressionAttributeValues: {
            ":item": [value],
            ":inc": 1
        }
    };    
    try {
        return await docClient.send(new UpdateCommand(command));
    } catch (error) {
        if (error.name === ERROR_NAME) return false;
        else throw error;
    }
}

export async function addPlayer (id, teamid, playerInstance) {
    const { userid } = playerInstance.data.profile;
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConditionExpression: "attribute_exists(#pk) AND attribute_not_exists(players.#playerId) AND team_inc.#teamId < team_size AND #state = :waitingState",
        UpdateExpression: "SET players.#playerId = :player, team_inc.#teamId = team_inc.#teamId + :inc",
        ExpressionAttributeNames: { 
            "#playerId": userid,
            "#teamId": teamid,
            "#state": "state",
            ...PK_EXPRESSION_NAME
        },
        ExpressionAttributeValues: { 
            ":player": playerInstance,
            ":inc": 1,
            ":waitingState": STATUS.WAITING
        }
    };
    try {
        return await docClient.send(new UpdateCommand(command));
    } catch (error) {
        if (error.name === ERROR_NAME) return false;
        else throw error;
    }
}

export async function removePlayer (id, playerid) {
    const teamid = await getPlayerTeam(id, playerid, false);
    if (teamid === undefined) {
        console.error(`Player ${playerid} does not exist in lobby ${id}.`);
        return false;
    }
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConditionExpression: "attribute_exists(#pk) AND attribute_exists(players.#playerId) AND players.#playerId.#metadata.#team = :teamId AND team_inc.#teamId > :zero AND #state = :waitingState AND host_player <> :playerId",
        UpdateExpression: "SET team_inc.#teamId = team_inc.#teamId - :inc REMOVE players.#playerId",
        ExpressionAttributeNames: { 
            "#playerId": playerid,
            "#teamId": teamid,
            "#team": "team",
            "#metadata": "data",
            "#state": "state",
            ...PK_EXPRESSION_NAME
        },
        ExpressionAttributeValues: { 
            ":inc": 1,
            ":zero": 0,
            ":playerId": playerid,
            ":teamId": teamid,
            ":waitingState": STATUS.WAITING
        }
    };
    try {
        return await docClient.send(new UpdateCommand(command));
    } catch (error) {
        if (error.name === ERROR_NAME) return false;
        else throw error;
    }
}

export async function changePlayerTeam (id, playerid, teamid) {
    const prevTeam = await getPlayerTeam(id, playerid, false);
    if (prevTeam === undefined) {
        console.error(`Player ${playerid} does not exist in lobby ${id}.`);
        return false;
    }
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConditionExpression: "attribute_exists(#pk) AND attribute_exists(players.#playerId) AND players.#playerId.#metadata.#team = :oldTeamId AND team_inc.#newTeamId < team_size AND team_inc.#oldTeamId > :zero AND #state = :waitingState",
        UpdateExpression: "SET players.#playerId.#metadata.#team = :newTeamId, team_inc.#newTeamId = team_inc.#newTeamId + :inc, team_inc.#oldTeamId = team_inc.#oldTeamId - :inc",
        ExpressionAttributeNames: { 
            "#playerId": playerid,
            "#oldTeamId": prevTeam,
            "#newTeamId": teamid,
            "#team": "team",
            "#metadata": "data",
            "#state": "state",
            ...PK_EXPRESSION_NAME
        },
        ExpressionAttributeValues: { 
            ":newTeamId": teamid,
            ":inc": 1,
            ":zero": 0,
            ":waitingState": STATUS.WAITING
        },
    }
    try {
        return await docClient.send(new UpdateCommand(command));
    } catch (error) {
        if (error.name === ERROR_NAME) return false;
        else throw error;
    }
}

export async function isLobbyFull (id) {
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConditionExpression: PK_EXISTS_CONDITION,
        ProjectionExpression: "team_size, team_inc",
        ConsistentRead: false, // [!] we might want to make this true, if enough players complain about lobbies not starting. - KT
        ExpressionAttributeNames: PK_EXPRESSION_NAME,
    };
    try {
        const response = await docClient.send(new GetCommand(command));
        if (!response.Item || !response.Item.teams) {
            console.error(`Database entry for lobby ${id} is malformed.`);
            return null;
        }
        const teamSize = response.Item.team_size;
        const teamsMap = response.Item.team_inc;
        const sizes = Object.values(teamsMap);
        return sizes.every((size) => size >= teamSize);
    } catch (error) {
        if (error.name === ERROR_NAME) return null;
        else throw error;
    }
}

export async function startLobby (id, hostid, turnOrder) {
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConditionExpression: "attribute_exists(#pk) AND #state = :waitingState AND host_player = :hostId",
        UpdateExpression: `
            SET #state = :activeState,
                player_order = :turnOrder
        `,
        ExpressionAttributeNames: {
            "#state": "state",
            ...PK_EXPRESSION_NAME
        },
        ExpressionAttributeValues: {
            ":waitingState": STATUS.WAITING,
            ":activeState": STATUS.ACTIVE,
            ":hostId": hostid,
            ":turnOrder": [...turnOrder]
        },
    };
    try {
        return await docClient.send(new UpdateCommand(command));
    } catch (error) {
        if (error.name === ERROR_NAME) return null;
        else throw error;
    }
}

export async function startFullLobby (id, turnOrder) {
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConditionExpression: "attribute_exists(#pk) AND #state = :waitingState AND size(players) = player_limit",
        UpdateExpression: `
            SET #state = :activeState,
                player_order = :turnOrder
        `,
        ExpressionAttributeNames: {
            "#state": "state",
            ...PK_EXPRESSION_NAME
        },
        ExpressionAttributeValues: {
            ":waitingState": STATUS.WAITING,
            ":activeState": STATUS.ACTIVE,
            ":turnOrder": [...turnOrder]
        }
    };
    try {
        return await docClient.send(new UpdateCommand(command));
    } catch (error) {
        if (error.name === ERROR_NAME) return null;
        else throw error;
    }
}

export async function commitLobbyTurn (id, players) {
    const playerAttributeValues = {};
    const playerAttributeNames = {};
    let updatePlayerExpressions = "";
    let i = 0;
    for (const [ id, player ] of Object.entries(players)) {
        const key = `#playerKey${i}`;
        const val = `:val${i}`;
        updatePlayerExpressions += `, players.${key} = ${val}`;
        playerAttributeNames[key] = id;
        playerAttributeValues[val] = player;
        i++;
    }
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConditionExpression: "attribute_exists(#pk) AND #state = :activeState",
        UpdateExpression: `
            SET update_token = :emptyStr,
                update_expires = :emptyTimestamp,
                turn_count = turn_count + :inc
        ` + updatePlayerExpressions,
        ExpressionAttributeNames: {
            "#state": "state",
            ...playerAttributeNames,
            ...PK_EXPRESSION_NAME
        },
        ExpressionAttributeValues: {
            ":emptyTimestamp": -1,
            ":inc": 1,
            ":emptyStr": "",
            ":activeState": STATUS.ACTIVE,
            ...playerAttributeValues
        }
    };
    try {
        return await docClient.send(new UpdateCommand(command));
    } catch (error) {
        if (error.name === ERROR_NAME) return null;
        else throw error;
    }
}

export async function closeLobby (id) {
    const command = {
        TableName: process.env.AWS_DB,
        Key: { [PK]: id },
        ConditionExpression: "attribute_exists(#pk) AND #state <> :closeState",
        UpdateExpression: "SET #state = :closeState",
        ExpressionAttributeNames: {
            "#state": "state",
            ...PK_EXPRESSION_NAME
        },
        ExpressionAttributeValues: {
            ":closeState": STATUS.CLOSED
        },
    };
    try {
        return await docClient.send(new UpdateCommand(command));
    } catch (error) {
        if (error.name === ERROR_NAME) return null;
        else throw error;
    }
}

async function getPlayerTeam (id, playerid, consistentRead = false) {
    try {
        const attributeNames = {
            "#playerId": playerid,
            "#team": "team",
            "#metadata": "data"
        };
        const result = await docClient.send(new GetCommand({
            TableName: process.env.AWS_DB,
            Key: { [PK]: id },
            ProjectionExpression: "players.#playerId.#metadata.#team",
            ExpressionAttributeNames: names,
            ConsistentRead: !!consistentRead
        }));
        return result.Item
            ?.players
            ?.[attributeNames["#playerId"]]
            ?.[attributeNames["#metadata"]]
            ?.[attributeNames["#team"]];
    } catch (error) {
        console.error(error);
        return undefined;
    }
}

function parseNestedKey (key, indexOffset = 0, attributeName = "attr") {
    const keys = key?.split?.(".") || [];
    const names = Object.fromEntries(
        Array.from(keys, (k, i) =>
            [`#${attributeName}${i + indexOffset}`, k]));
    const expression = keys.length
        ? keys.map((k, i) => `#${attributeName}${i + indexOffset}`).join(".")
        : "";
    return { keys, names: names, expression: expression };
}