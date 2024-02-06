import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface CognitoAuthorizerResources extends cdk.StackProps {
}

export class CognitoAuthorizer extends cdk.Stack {
    constructor(scope: Construct, id: string, props: CognitoAuthorizerResources) {
        super(scope, id, props);

        // Option 1: Create a Cognito User Pool
        const userPool = new cognito.UserPool(this, 'MyUserPool', {
            selfSignUpEnabled: true,
            autoVerify: { email: true },
            signInAliases: { email: true },
        });

        // Create a Cognito User Pool Authorizer for API Gateway
        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'MyCognitoAuthorizer', {
            cognitoUserPools: [userPool],
        });

        // Option 2: Create a Lambda function for the custom authorizer
        const authorizerFunction = new lambda.Function(this, 'MyAuthorizerFunction', {
            runtime: lambda.Runtime.NODEJS_16_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('authorizer'),
        });

        // Create a Lambda Authorizer for API Gateway
        const customAuthorizer = new apigateway.TokenAuthorizer(this, 'MyCustomAuthorizer', {
            handler: authorizerFunction,
        });

        // Create an API Gateway
        const api = new apigateway.RestApi(this, 'MyApi', {
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
            },
        });

        // Add methods and associate authorizers with different routes
        const resource = api.root.addResource('myresource');
        resource.addMethod('GET', new apigateway.HttpIntegration('http://example.com'), {
            authorizer: authorizer, // Cognito User Pool Authorizer
        });
        resource.addMethod('POST', new apigateway.HttpIntegration('http://example.com'), {
            authorizer: customAuthorizer, // Custom Lambda Authorizer
        });

    }
}