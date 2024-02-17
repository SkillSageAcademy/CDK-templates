package templates

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsroute53"
	"github.com/aws/jsii-runtime-go"
)

func CNamePolicies() {
	app := awscdk.NewApp(nil)

	stack := awscdk.NewStack(app, jsii.String("ABTestingStack"), &awscdk.StackProps{
		Env: &awscdk.Environment{
			Account: jsii.String("YOUR_ACCOUNT_ID"),
			Region:  jsii.String("YOUR_REGION"),
		},
	})

	// Create a hosted zone
	hostedZone := awsroute53.NewHostedZone(stack, jsii.String("MyHostedZone"), &awsroute53.HostedZoneProps{
		ZoneName: jsii.String("example.com"), // Replace with your domain name
	})

	// Create a CNAME record
	awsroute53.NewCnameRecord(stack, jsii.String("MyCnameRecord"), &awsroute53.CnameRecordProps{
		Zone:       hostedZone,
		RecordName: jsii.String("sub.example.com"), // Subdomain
		Weight:     jsii.Number(50),
		DomainName: jsii.String("example.com"),
		Comment:    jsii.String("example cname record"),
	})

	// Create a CNAME record
	awsroute53.NewCnameRecord(stack, jsii.String("MyCnameRecord"), &awsroute53.CnameRecordProps{
		Zone:       hostedZone,
		RecordName: jsii.String("sub.example.com"), // Subdomain
		Weight:     jsii.Number(50),
		DomainName: jsii.String("example.com"),
		Comment:    jsii.String("example cname record"),
		Region:     jsii.String("eu-west-1"),
	})
}

func ARecord() {
	app := awscdk.NewApp(nil)

	stack := awscdk.NewStack(app, jsii.String("ABTestingStack"), &awscdk.StackProps{
		Env: &awscdk.Environment{
			Account: jsii.String("YOUR_ACCOUNT_ID"),
			Region:  jsii.String("YOUR_REGION"),
		},
	})

	// Create a Route 53 hosted zone
	hostedZone := awsroute53.NewHostedZone(stack, jsii.String("MyHostedZone"), &awsroute53.HostedZoneProps{
		ZoneName: jsii.String("example.com"),
	})

	// Create A record
	awsroute53.NewARecord(stack, jsii.String("ARecord"), &awsroute53.ARecordProps{
		Zone:       hostedZone,
		RecordName: jsii.String("www"),
		Target:     awsroute53.RecordTarget_FromIpAddresses(jsii.String("1.2.3.4"), jsii.String("5.6.7.8")),
	})
}

func GeoLocationRouting() {
	app := awscdk.NewApp(nil)

	stack := awscdk.NewStack(app, jsii.String("ABTestingStack"), &awscdk.StackProps{
		Env: &awscdk.Environment{
			Account: jsii.String("YOUR_ACCOUNT_ID"),
			Region:  jsii.String("YOUR_REGION"),
		},
	})

	// Create a hosted zone
	hostedZone := awsroute53.NewHostedZone(stack, jsii.String("MyHostedZone"), &awsroute53.HostedZoneProps{
		ZoneName: jsii.String("example.com"), // Replace with your domain name
	})

	// Create a CNAME record
	awsroute53.NewCnameRecord(stack, jsii.String("MyCnameRecord"), &awsroute53.CnameRecordProps{
		Zone:        hostedZone,
		RecordName:  jsii.String("sub.example.com"), // Subdomain
		GeoLocation: awsroute53.GeoLocation_Continent(awsroute53.Continent_EUROPE),
		DomainName:  jsii.String("example.com"),
		Comment:     jsii.String("example cname record"),
		Region:      jsii.String("eu-west-1"),
	})

	// continent
	// continent
	awsroute53.NewARecord(stack, jsii.String("ARecordGeoLocationContinent"), &awsroute53.ARecordProps{
		Zone:        hostedZone,
		Target:      awsroute53.RecordTarget_FromIpAddresses(jsii.String("1.2.3.0"), jsii.String("5.6.7.0")),
		GeoLocation: awsroute53.GeoLocation_Continent(awsroute53.Continent_EUROPE),
	})

	// country
	// country
	awsroute53.NewARecord(stack, jsii.String("ARecordGeoLocationCountry"), &awsroute53.ARecordProps{
		Zone:        hostedZone,
		Target:      awsroute53.RecordTarget_FromIpAddresses(jsii.String("1.2.3.1"), jsii.String("5.6.7.1")),
		GeoLocation: awsroute53.GeoLocation_Country(jsii.String("DE")),
	})

	// subdivision
	// subdivision
	awsroute53.NewARecord(stack, jsii.String("ARecordGeoLocationSubDividion"), &awsroute53.ARecordProps{
		Zone:        hostedZone,
		Target:      awsroute53.RecordTarget_FromIpAddresses(jsii.String("1.2.3.2"), jsii.String("5.6.7.2")),
		GeoLocation: awsroute53.GeoLocation_Subdivision(jsii.String("Subdivision Code"), jsii.String("WA")),
	})

	// default (wildcard record if no specific record is found)
	// default (wildcard record if no specific record is found)
	awsroute53.NewARecord(stack, jsii.String("ARecordGeoLocationDefault"), &awsroute53.ARecordProps{
		Zone:        hostedZone,
		Target:      awsroute53.RecordTarget_FromIpAddresses(jsii.String("1.2.3.3"), jsii.String("5.6.7.3")),
		GeoLocation: awsroute53.GeoLocation_Default(),
	})
}

func LatencyRouting() {
	app := awscdk.NewApp(nil)

	stack := awscdk.NewStack(app, jsii.String("ABTestingStack"), &awscdk.StackProps{
		Env: &awscdk.Environment{
			Account: jsii.String("YOUR_ACCOUNT_ID"),
			Region:  jsii.String("YOUR_REGION"),
		},
	})

	awsroute53.NewCfnHealthCheck(stack, jsii.String("MyCfnHealthCheck"), &awsroute53.CfnHealthCheckProps{
		HealthCheckConfig: &awsroute53.CfnHealthCheck_HealthCheckConfigProperty{
			Type: jsii.String("type"),

			// the properties below are optional
			AlarmIdentifier: &awsroute53.CfnHealthCheck_AlarmIdentifierProperty{
				Name:   jsii.String("name"),
				Region: jsii.String("region"),
			},
			ChildHealthChecks: &[]*string{
				jsii.String("childHealthChecks"),
			},
			EnableSni:                    jsii.Bool(false),
			FailureThreshold:             jsii.Number(123),
			FullyQualifiedDomainName:     jsii.String("fullyQualifiedDomainName"),
			HealthThreshold:              jsii.Number(123),
			InsufficientDataHealthStatus: jsii.String("insufficientDataHealthStatus"),
			Inverted:                     jsii.Bool(false),
			IpAddress:                    jsii.String("ipAddress"),
			MeasureLatency:               jsii.Bool(false),
			Port:                         jsii.Number(123),
			Regions: &[]*string{
				jsii.String("regions"),
			},
			RequestInterval:   jsii.Number(123),
			ResourcePath:      jsii.String("resourcePath"),
			RoutingControlArn: jsii.String("routingControlArn"),
			SearchString:      jsii.String("searchString"),
		},

		// the properties below are optional
		HealthCheckTags: []interface{}{
			&awsroute53.CfnHealthCheck_HealthCheckTagProperty{
				Key:   jsii.String("key"),
				Value: jsii.String("value"),
			},
		},
	})
}
