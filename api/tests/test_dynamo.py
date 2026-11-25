import boto3
from moto import mock_aws

from app.dynamo import get_table


@mock_aws
def test_get_table_grava_e_le_item_e_reutiliza_objeto() -> None:
    boto3.client("dynamodb", region_name="us-east-1").create_table(
        TableName="acp-test",
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    table = get_table()
    table.put_item(Item={"PK": "USER#u1", "SK": "DESIGN#d1", "name": "dev"})
    assert table.get_item(Key={"PK": "USER#u1", "SK": "DESIGN#d1"})["Item"]["name"] == "dev"
    assert get_table() is table
